/**
 * @fileoverview SourceCodeVisitor class
 * @author Nicholas C. Zakas
 */

"use strict";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const emptyArray = Object.freeze([]);

//------------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------------

/**
 * A structure to hold a list of functions to call for a given name.
 * This is used to allow multiple rules to register functions for a given name
 * without having to know about each other.
 */
class SourceCodeVisitor {
	/**
	 * The functions to call for a given name.
	 * @type {Map<string, Function[]>}
	 */
	#functions = new Map();

	/**
	 * Rule IDs parallel to #functions for error attribution.
	 * @type {Map<string, string[]>}
	 */
	#ruleIds = new Map();

	/**
	 * Adds a function to the list of functions to call for a given name.
	 * @param {string} name The name of the function to call.
	 * @param {Function} func The function to call.
	 * @param {string} [ruleId] The rule ID for error attribution.
	 * @returns {void}
	 */
	add(name, func, ruleId) {
		if (this.#functions.has(name)) {
			this.#functions.get(name).push(func);
			this.#ruleIds.get(name).push(ruleId);
		} else {
			this.#functions.set(name, [func]);
			this.#ruleIds.set(name, [ruleId]);
		}
	}

	/**
	 * Gets the list of functions to call for a given name.
	 * @param {string} name The name of the function to call.
	 * @returns {Function[]} The list of functions to call.
	 */
	get(name) {
		if (this.#functions.has(name)) {
			return this.#functions.get(name);
		}

		return emptyArray;
	}

	/**
	 * Iterates over all names and calls the callback with the name.
	 * @param {(name:string) => void} callback The callback to call for each name.
	 * @returns {void}
	 */
	forEachName(callback) {
		this.#functions.forEach((funcs, name) => {
			callback(name);
		});
	}

	/**
	 * Calls the functions for a given name with the given arguments.
	 * Uses explicit positional args to avoid rest/spread overhead.
	 * Includes try-catch with ruleId attribution so callers don't
	 * need wrapper closures.
	 * @param {string} name The name of the function to call.
	 * @param {any} a First argument.
	 * @param {any} b Second argument.
	 * @param {any} c Third argument.
	 * @returns {void}
	 * @throws {any} Re-throws errors from listener functions with ruleId attribution.
	 */
	callSync(name, a, b, c) {
		const funcs = this.#functions.get(name);

		if (funcs) {
			const ruleIds = this.#ruleIds.get(name);

			for (let i = 0; i < funcs.length; i++) {
				try {
					funcs[i](a, b, c);
				} catch (e) {
					if (ruleIds[i]) {
						e.ruleId = ruleIds[i];
					}
					throw e;
				}
			}
		}
	}

	/**
	 * Fast path for calling functions with a single argument.
	 * Avoids rest/spread overhead and forEach closure allocation.
	 * Includes try-catch with ruleId attribution so callers don't
	 * need wrapper closures.
	 * @param {string} name The name of the function to call.
	 * @param {any} arg The single argument to pass.
	 * @returns {void}
	 * @throws {any} Re-throws errors from listener functions with ruleId attribution.
	 */
	callSyncSingle(name, arg) {
		const funcs = this.#functions.get(name);

		if (funcs) {
			const ruleIds = this.#ruleIds.get(name);

			for (let i = 0; i < funcs.length; i++) {
				try {
					funcs[i](arg);
				} catch (e) {
					if (ruleIds[i]) {
						e.ruleId = ruleIds[i];
					}
					throw e;
				}
			}
		}
	}
}

module.exports = { SourceCodeVisitor };
