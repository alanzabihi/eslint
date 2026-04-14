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
	 * Adds a function to the list of functions to call for a given name.
	 * @param {string} name The name of the function to call.
	 * @param {Function} func The function to call.
	 * @returns {void}
	 */
	add(name, func) {
		if (this.#functions.has(name)) {
			this.#functions.get(name).push(func);
		} else {
			this.#functions.set(name, [func]);
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
	 * @param {string} name The name of the function to call.
	 * @param {any[]} args The arguments to pass to the function.
	 * @returns {void}
	 */
	callSync(name, ...args) {
		if (this.#functions.has(name)) {
			this.#functions.get(name).forEach(func => func(...args));
		}
	}

	/**
	 * Calls the functions for a given name with a single argument.
	 * @param {string} name The name of the function to call.
	 * @param {any} arg The argument to pass.
	 * @returns {void}
	 */
	callSyncSingle(name, arg) {
		const funcs = this.#functions.get(name);

		if (funcs) {
			for (let i = 0; i < funcs.length; i++) {
				funcs[i](arg);
			}
		}
	}

	/**
	 * Calls the functions for a given name with two arguments.
	 * @param {string} name The name of the function to call.
	 * @param {any} a First argument.
	 * @param {any} b Second argument.
	 * @returns {void}
	 */
	callSync2(name, a, b) {
		const funcs = this.#functions.get(name);

		if (funcs) {
			for (let i = 0; i < funcs.length; i++) {
				funcs[i](a, b);
			}
		}
	}

	/**
	 * Calls the functions for a given name with three arguments.
	 * @param {string} name The name of the function to call.
	 * @param {any} a First argument.
	 * @param {any} b Second argument.
	 * @param {any} c Third argument.
	 * @returns {void}
	 */
	callSync3(name, a, b, c) {
		const funcs = this.#functions.get(name);

		if (funcs) {
			for (let i = 0; i < funcs.length; i++) {
				funcs[i](a, b, c);
			}
		}
	}
}

module.exports = { SourceCodeVisitor };
