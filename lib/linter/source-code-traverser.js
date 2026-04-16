/**
 * @fileoverview Traverser for SourceCode objects.
 * @author Nicholas C. Zakas
 */

"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { parse, matches } = require("./esquery");
const vk = require("eslint-visitor-keys");

//-----------------------------------------------------------------------------
// Typedefs
//-----------------------------------------------------------------------------

/**
 * @import { Language, SourceCode } from "@eslint/core";
 * @import { ESQueryOptions } from "esquery";
 * @import { ESQueryParsedSelector } from "./esquery.js";
 * @import { SourceCodeVisitor } from "./source-code-visitor.js";
 */

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const STEP_KIND_VISIT = 1;
const STEP_KIND_CALL = 2;

/**
 * Compares two ESQuery selectors by specificity.
 * @param {ESQueryParsedSelector} a The first selector to compare.
 * @param {ESQueryParsedSelector} b The second selector to compare.
 * @returns {number} A negative number if `a` is less specific than `b` or they are equally specific and `a` <= `b` alphabetically, a positive number if `a` is more specific than `b`.
 */
function compareSpecificity(a, b) {
	return a.compare(b);
}

/**
 * Merges two sorted selector arrays into one sorted array by specificity.
 * @param {ESQueryParsedSelector[]} a First sorted array.
 * @param {ESQueryParsedSelector[]} b Second sorted array.
 * @returns {ESQueryParsedSelector[]} Merged sorted array.
 */
function mergeSorted(a, b) {
	const result = new Array(a.length + b.length);
	let ai = 0,
		bi = 0,
		ri = 0;

	while (ai < a.length && bi < b.length) {
		if (a[ai].compare(b[bi]) <= 0) {
			result[ri++] = a[ai++];
		} else {
			result[ri++] = b[bi++];
		}
	}
	while (ai < a.length) {
		result[ri++] = a[ai++];
	}
	while (bi < b.length) {
		result[ri++] = b[bi++];
	}
	return result;
}

/**
 * Helper to wrap ESQuery operations.
 */
class ESQueryHelper {
	/**
	 * Creates a new instance.
	 * @param {SourceCodeVisitor} visitor The visitor containing the functions to call.
	 * @param {ESQueryOptions} esqueryOptions `esquery` options for traversing custom nodes.
	 */
	constructor(visitor, esqueryOptions) {
		/**
		 * The visitor to use during traversal.
		 * @type {SourceCodeVisitor}
		 */
		this.visitor = visitor;

		/**
		 * The options for `esquery` to use during matching.
		 * @type {ESQueryOptions}
		 */
		this.esqueryOptions = esqueryOptions;

		/**
		 * A map of node type to selectors targeting that node type on the
		 * enter phase of traversal.
		 * @type {Map<string, ESQueryParsedSelector[]>}
		 */
		this.enterSelectorsByNodeType = new Map();

		/**
		 * A map of node type to selectors targeting that node type on the
		 * exit phase of traversal.
		 * @type {Map<string, ESQueryParsedSelector[]>}
		 */
		this.exitSelectorsByNodeType = new Map();

		/**
		 * An array of selectors that match any node type on the
		 * enter phase of traversal.
		 * @type {ESQueryParsedSelector[]}
		 */
		this.anyTypeEnterSelectors = [];

		/**
		 * An array of selectors that match any node type on the
		 * exit phase of traversal.
		 * @type {ESQueryParsedSelector[]}
		 */
		this.anyTypeExitSelectors = [];

		visitor.forEachName(rawSelector => {
			const selector = parse(rawSelector);

			/*
			 * If this selector has identified specific node types,
			 * add it to the map for these node types for faster lookup.
			 */
			if (selector.nodeTypes) {
				const typeMap = selector.isExit
					? this.exitSelectorsByNodeType
					: this.enterSelectorsByNodeType;

				selector.nodeTypes.forEach(nodeType => {
					if (!typeMap.has(nodeType)) {
						typeMap.set(nodeType, []);
					}
					typeMap.get(nodeType).push(selector);
				});
				return;
			}

			/*
			 * Remaining selectors are added to the "any type" selectors
			 * list for the appropriate phase of traversal. This ensures
			 * that all selectors will still be applied even if no
			 * specific node type is matched.
			 */
			const selectors = selector.isExit
				? this.anyTypeExitSelectors
				: this.anyTypeEnterSelectors;

			selectors.push(selector);
		});

		// sort all selectors by specificity for prioritizing call order
		this.anyTypeEnterSelectors.sort(compareSpecificity);
		this.anyTypeExitSelectors.sort(compareSpecificity);
		this.enterSelectorsByNodeType.forEach(selectorList =>
			selectorList.sort(compareSpecificity),
		);
		this.exitSelectorsByNodeType.forEach(selectorList =>
			selectorList.sort(compareSpecificity),
		);

		// Pre-merge type-specific selectors with anyType selectors
		this.preMergedEnter = new Map();
		this.preMergedExit = new Map();

		for (const [nodeType, typeSelectors] of this.enterSelectorsByNodeType) {
			this.preMergedEnter.set(
				nodeType,
				mergeSorted(typeSelectors, this.anyTypeEnterSelectors),
			);
		}

		for (const [nodeType, typeSelectors] of this.exitSelectorsByNodeType) {
			this.preMergedExit.set(
				nodeType,
				mergeSorted(typeSelectors, this.anyTypeExitSelectors),
			);
		}
	}

	/**
	 * Dispatches all matching selectors for a node directly to the visitor.
	 * @param {ASTNode} node The node to check
	 * @param {ASTNode[]} ancestry The ancestry of the node being checked.
	 * @param {boolean} isExit `false` if the node is currently being entered, `true` if it's currently being exited
	 * @param {SourceCodeVisitor} visitor The visitor to dispatch to.
	 * @returns {void}
	 */
	dispatchSelectors(node, ancestry, isExit, visitor) {
		const nodeTypeKey = this.esqueryOptions?.nodeTypeKey || "type";
		const preMergedMap = isExit ? this.preMergedExit : this.preMergedEnter;
		const anyTypeSelectors = isExit
			? this.anyTypeExitSelectors
			: this.anyTypeEnterSelectors;
		const merged = preMergedMap.get(node[nodeTypeKey]) || anyTypeSelectors;

		for (let i = 0; i < merged.length; i++) {
			if (matches(node, merged[i].root, ancestry, this.esqueryOptions)) {
				visitor.callSyncSingle(merged[i].source, node);
			}
		}
	}
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

/**
 * Traverses source code and ensures that visitor methods are called when
 * entering and leaving each node.
 */
class SourceCodeTraverser {
	/**
	 * The language of the source code being traversed.
	 * @type {Language}
	 */
	#language;

	/**
	 * Map of languages to instances of this class.
	 * @type {WeakMap<Language, SourceCodeTraverser>}
	 */
	static instances = new WeakMap();

	/**
	 * Creates a new instance.
	 * @param {Language} language The language of the source code being traversed.
	 */
	constructor(language) {
		this.#language = language;
	}

	static getInstance(language) {
		if (!this.instances.has(language)) {
			this.instances.set(language, new this(language));
		}

		return this.instances.get(language);
	}

	/**
	 * Traverses the given source code synchronously.
	 * @param {SourceCode} sourceCode The source code to traverse.
	 * @param {SourceCodeVisitor} visitor The emitter to use for events.
	 * @param {Object} options Options for traversal.
	 * @param {ReturnType<SourceCode["traverse"]>} options.steps The steps to take during traversal.
	 * @returns {void}
	 * @throws {Error} If an error occurs during traversal.
	 */
	traverseSync(sourceCode, visitor, { steps } = {}) {
		const esquery = new ESQueryHelper(visitor, {
			visitorKeys: sourceCode.visitorKeys ?? this.#language.visitorKeys,
			fallback: vk.getKeys,
			matchClass: this.#language.matchesSelectorClass ?? (() => false),
			nodeTypeKey: this.#language.nodeTypeKey,
		});

		const currentAncestry = [];

		for (const step of steps ?? sourceCode.traverse()) {
			switch (step.kind) {
				case STEP_KIND_VISIT: {
					try {
						const node = step.target;

						if (step.phase === 1) {
							esquery.dispatchSelectors(
								node,
								currentAncestry,
								false,
								visitor,
							);
							currentAncestry.unshift(node);
						} else {
							currentAncestry.shift();
							esquery.dispatchSelectors(
								node,
								currentAncestry,
								true,
								visitor,
							);
						}
					} catch (err) {
						err.currentNode = step.target;
						throw err;
					}
					break;
				}

				case STEP_KIND_CALL: {
					if (step.c !== void 0) {
						visitor.callSync3(step.target, step.a, step.b, step.c);
					} else {
						visitor.callSync2(step.target, step.a, step.b);
					}
					break;
				}

				default:
					throw new Error(
						`Invalid traversal step found: "${step.kind}".`,
					);
			}
		}
	}
}

module.exports = { SourceCodeTraverser };
