/**
 * @fileoverview ESQuery wrapper for ESLint.
 * @author Nicholas C. Zakas
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const esquery = require("esquery");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/**
 * @typedef {import("esquery").Selector} ESQuerySelector
 * @typedef {import("esquery").ESQueryOptions} ESQueryOptions
 */

//------------------------------------------------------------------------------
// Classes
//------------------------------------------------------------------------------

/**
 * The result of parsing and analyzing an ESQuery selector.
 */
class ESQueryParsedSelector {
	/**
	 * The raw selector string that was parsed
	 * @type {string}
	 */
	source;

	/**
	 * Whether this selector is an exit selector
	 * @type {boolean}
	 */
	isExit;

	/**
	 * An object (from esquery) describing the matching behavior of the selector
	 * @type {ESQuerySelector}
	 */
	root;

	/**
	 * The node types that could possibly trigger this selector, or `null` if all node types could trigger it
	 * @type {string[]|null}
	 */
	nodeTypes;

	/**
	 * The number of class, pseudo-class, and attribute queries in this selector
	 * @type {number}
	 */
	attributeCount;

	/**
	 * The number of identifier queries in this selector
	 * @type {number}
	 */
	identifierCount;

	/**
	 * Creates a new parsed selector.
	 * @param {string} source The raw selector string that was parsed
	 * @param {boolean} isExit Whether this selector is an exit selector
	 * @param {ESQuerySelector} root An object (from esquery) describing the matching behavior of the selector
	 * @param {string[]|null} nodeTypes The node types that could possibly trigger this selector, or `null` if all node types could trigger it
	 * @param {number} attributeCount The number of class, pseudo-class, and attribute queries in this selector
	 * @param {number} identifierCount The number of identifier queries in this selector
	 * @param {Function|boolean|null} fastCheck A compiled fast-check function, `true` for guaranteed matches, or `null`
	 */
	constructor(
		source,
		isExit,
		root,
		nodeTypes,
		attributeCount,
		identifierCount,
		fastCheck,
	) {
		this.source = source;
		this.isExit = isExit;
		this.root = root;
		this.nodeTypes = nodeTypes;
		this.attributeCount = attributeCount;
		this.identifierCount = identifierCount;
		this.fastCheck = fastCheck;
	}

	/**
	 * Compares this selector's specificity to another selector for sorting purposes.
	 * @param {ESQueryParsedSelector} otherSelector The selector to compare against
	 * @returns {number}
	 * a value less than 0 if this selector is less specific than otherSelector
	 * a value greater than 0 if this selector is more specific than otherSelector
	 * a value less than 0 if this selector and otherSelector have the same specificity, and this selector <= otherSelector alphabetically
	 * a value greater than 0 if this selector and otherSelector have the same specificity, and this selector > otherSelector alphabetically
	 */
	compare(otherSelector) {
		return (
			this.attributeCount - otherSelector.attributeCount ||
			this.identifierCount - otherSelector.identifierCount ||
			(this.source <= otherSelector.source ? -1 : 1)
		);
	}
}

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

const selectorCache = new Map();

/**
 * Computes the union of one or more arrays
 * @param {...any[]} arrays One or more arrays to union
 * @returns {any[]} The union of the input arrays
 */
function union(...arrays) {
	return [...new Set(arrays.flat())];
}

/**
 * Computes the intersection of one or more arrays
 * @param {...any[]} arrays One or more arrays to intersect
 * @returns {any[]} The intersection of the input arrays
 */
function intersection(...arrays) {
	if (arrays.length === 0) {
		return [];
	}

	let result = [...new Set(arrays[0])];

	for (const array of arrays.slice(1)) {
		result = result.filter(x => array.includes(x));
	}
	return result;
}

/**
 * Analyzes a parsed selector and returns combined data about it
 * @param {ESQuerySelector} parsedSelector An object (from esquery) describing the matching behavior of the selector
 * @returns {{nodeTypes:string[]|null, attributeCount:number, identifierCount:number}} Object containing selector data.
 */
function analyzeParsedSelector(parsedSelector) {
	let attributeCount = 0;
	let identifierCount = 0;

	/**
	 * Analyzes a selector and returns the node types that could possibly trigger it.
	 * @param {ESQuerySelector} selector The selector to analyze.
	 * @returns {string[]|null} The node types that could possibly trigger this selector, or `null` if all node types could trigger it
	 */
	function analyzeSelector(selector) {
		switch (selector.type) {
			case "identifier":
				identifierCount++;
				return [selector.value];

			case "not":
				selector.selectors.map(analyzeSelector);
				return null;

			case "matches": {
				const typesForComponents =
					selector.selectors.map(analyzeSelector);

				if (typesForComponents.every(Boolean)) {
					return union(...typesForComponents);
				}
				return null;
			}

			case "compound": {
				const typesForComponents = selector.selectors
					.map(analyzeSelector)
					.filter(typesForComponent => typesForComponent);

				// If all of the components could match any type, then the compound could also match any type.
				if (!typesForComponents.length) {
					return null;
				}

				/*
				 * If at least one of the components could only match a particular type, the compound could only match
				 * the intersection of those types.
				 */
				return intersection(...typesForComponents);
			}

			case "attribute":
			case "field":
			case "nth-child":
			case "nth-last-child":
				attributeCount++;
				return null;

			case "child":
			case "descendant":
			case "sibling":
			case "adjacent":
				analyzeSelector(selector.left);
				return analyzeSelector(selector.right);

			case "class":
				// TODO: abstract into JSLanguage somehow
				if (selector.name === "function") {
					return [
						"FunctionDeclaration",
						"FunctionExpression",
						"ArrowFunctionExpression",
					];
				}
				return null;

			default:
				return null;
		}
	}

	const nodeTypes = analyzeSelector(parsedSelector);

	return {
		nodeTypes,
		attributeCount,
		identifierCount,
	};
}

/**
 * Tries to parse a simple selector string, such as a single identifier or wildcard.
 * This saves time by avoiding the overhead of esquery parsing for simple cases.
 * @param {string} selector The selector string to parse.
 * @returns {Object|null} An object describing the selector if it is simple, or `null` if it is not.
 */
function trySimpleParseSelector(selector) {
	if (selector === "*") {
		return {
			type: "wildcard",
			value: "*",
		};
	}

	if (/^[a-z]+$/iu.test(selector)) {
		return {
			type: "identifier",
			value: selector,
		};
	}

	return null;
}

/**
 * Parses a raw selector string, and throws a useful error if parsing fails.
 * @param {string} selector The selector string to parse.
 * @returns {Object} An object (from esquery) describing the matching behavior of this selector
 * @throws {Error} An error if the selector is invalid
 */
function tryParseSelector(selector) {
	try {
		return esquery.parse(selector);
	} catch (err) {
		if (
			err.location &&
			err.location.start &&
			typeof err.location.start.offset === "number"
		) {
			throw new SyntaxError(
				`Syntax error in selector "${selector}" at position ${err.location.start.offset}: ${err.message}`,
				{
					cause: err,
				},
			);
		}
		throw err;
	}
}

/**
 * Compiles a fast-check function for a parsed selector when possible.
 * Returns a function (node, ancestry) => boolean, or null if compilation
 * is not possible.
 *
 * Handles three patterns:
 *  1. "matches" selectors where all sub-selectors are identifiers
 *     (e.g. "Identifier, JSXIdentifier") — guaranteed to match when
 *     dispatched from the type-specific pre-merged map.
 *  2. "compound" selectors of identifier + simple attribute checks
 *     (e.g. "Literal[regex]", "MethodDefinition[kind='constructor']").
 *  3. "child" selectors where left is identifier and right is field
 *     (e.g. "ForStatement > .test") — compiled to parent type + field check.
 * @param {ESQuerySelector} root The parsed selector root.
 * @param {string[]|null} nodeTypes The resolved node types.
 * @returns {Function|null} A fast matcher or null.
 */
function compileFastCheck(root, nodeTypes) {
	/*
	 * Pattern 1: matches selector with all-identifier sub-selectors.
	 * When dispatched from the type-specific map, the node type is
	 * already known to be one of the identifiers, so the match is guaranteed.
	 */
	if (
		root.type === "matches" &&
		nodeTypes &&
		root.selectors.every(s => s.type === "identifier")
	) {
		return null; // signal: use guaranteedMatch flag instead
	}

	// Pattern 2: compound selector = identifier + attribute checks only.
	if (root.type === "compound" && nodeTypes) {
		const attrSelectors = root.selectors.filter(
			s => s.type !== "identifier",
		);

		// All non-identifier parts must be simple attribute checks
		if (
			attrSelectors.length > 0 &&
			attrSelectors.every(s => s.type === "attribute")
		) {
			const checks = [];

			for (const attr of attrSelectors) {
				const name = attr.name;

				/*
				 * Dot-path attributes (e.g. [callee.name='Promise']) require
				 * deep property traversal — skip compilation for these.
				 */
				if (name.includes(".")) {
					return null;
				}

				switch (attr.operator) {
					case void 0:
						// existence check: [regex]
						checks.push(
							node =>
								node[name] !== null && node[name] !== void 0,
						);
						break;
					case "=": {
						/*
						 * esquery coerces node values to strings before comparing:
						 * [computed=true] matches both boolean true and string "true".
						 */
						const val = attr.value.value;

						checks.push(node => String(node[name]) === val);
						break;
					}
					case "!=": {
						const val = attr.value.value;

						checks.push(node => String(node[name]) !== val);
						break;
					}
					default:
						return null; // unsupported operator
				}
			}

			if (checks.length === 1) {
				return checks[0];
			}
			return node => {
				for (let i = 0; i < checks.length; i++) {
					if (!checks[i](node)) {
						return false;
					}
				}
				return true;
			};
		}
	}

	/*
	 * Pattern 3: child selector with identifier left + field right.
	 * e.g. "ForStatement > .test" → check parent type and field name.
	 */
	if (
		root.type === "child" &&
		root.left.type === "identifier" &&
		root.right.type === "field"
	) {
		const parentType = root.left.value;
		const fieldName = root.right.name;

		return (node, ancestry) =>
			ancestry.length > 0 &&
			ancestry[0].type === parentType &&
			ancestry[0][fieldName] === node;
	}

	return null;
}

/**
 * Parses a raw selector string, and returns the parsed selector along with specificity and type information.
 * @param {string} source A raw AST selector
 * @returns {ESQueryParsedSelector} A selector descriptor
 */
function parse(source) {
	if (selectorCache.has(source)) {
		return selectorCache.get(source);
	}

	const cleanSource = source.replace(/:exit$/u, "");
	const parsedSelector =
		trySimpleParseSelector(cleanSource) ?? tryParseSelector(cleanSource);
	const { nodeTypes, attributeCount, identifierCount } =
		analyzeParsedSelector(parsedSelector);

	/*
	 * Try to compile a fast-check for this selector.
	 *  - For all-identifier "matches" selectors, set fastCheck = true
	 *    (guaranteed match when dispatched from type-specific map).
	 *  - For "compound" selectors with only identifier + simple attributes,
	 *    set fastCheck to a compiled function.
	 *  - Otherwise, fastCheck = null (use full esquery.matches).
	 */
	let fastCheck = compileFastCheck(parsedSelector, nodeTypes);

	if (
		fastCheck === null &&
		parsedSelector.type === "matches" &&
		nodeTypes &&
		parsedSelector.selectors.every(s => s.type === "identifier")
	) {
		fastCheck = true;
	}

	const result = new ESQueryParsedSelector(
		source,
		source.endsWith(":exit"),
		parsedSelector,
		nodeTypes,
		attributeCount,
		identifierCount,
		fastCheck,
	);

	selectorCache.set(source, result);
	return result;
}

/**
 * Checks if a node matches a given selector.
 * @param {Object} node The node to check against the selector.
 * @param {ESQuerySelector} root The root of the selector to match against.
 * @param {Object[]} ancestry The ancestry of the node being checked, which is an array of nodes from the current node to the root.
 * @param {ESQueryOptions} options The options to use for matching.
 * @returns {boolean} `true` if the node matches the selector, `false` otherwise.
 */
function matches(node, root, ancestry, options) {
	return esquery.matches(node, root, ancestry, options);
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

module.exports = {
	parse,
	matches,
	ESQueryParsedSelector,
};
