const inflectFromTable = require("../../helper/inflect-from-table");
const inflector = require("../../helper/inflector");
const validateAgainstSchema = require("../../helper/validate-against-schema");

class JsonSchema {

	constructor(object) {
		this.object = object;
	}
	/**
	 * @returns {string}
	 */
	get $id() {
		return this.object.$id;
	}

	get id() {
		return this.object.id;
	}

	/**
	 * @returns {string}
	 */
	get $schema() {
		return this.object.$schema
	}

	/**
	 * @returns {string}
	 */
	get dataSource() {
		return this.object.dataSource
	}

	/**
	 * @returns {string}
	 */
	get baseName() {
		return this.object.baseName
	}

	/**
	 * @returns {string}
	 */
	get className() {
		return inflector.classify(this.object.baseName)
	}

	/**
	 * @returns {string}
	 */
	get description() {
		return this.object.description
	}

	/**
	 * @returns {string}
	 */
	get primaryKey() {
		return this.object.primaryKey
	}
	/**
	 * @returns {object}
	 */
	get properties() {
		return this.object.properties;
	}

	get route() {
		if (!this.object.route) {
			this.object.route = inflectFromTable.route(this.tableName)
		}
		return this.object.route;
	}

	set route(value) {
		return this.object.route = value;
	}
	/**
	 * @returns {array}
	 */
	get readOnly() {
		return this.object.readOnly
	}
	/**
	 * @returns {array}
	 */
	get required() {
		return this.object.required;
	}
	/**
	 * @returns {boolean}
	 */
	get additionalProperties() {
		return this.object.additionalProperties
	}
	/**
	 * @returns {string}
	 */
	get title() {
		return this.object.title
	}

	/**
	 * @returns {string}
	 */
	get tableName() {
		return this.object.tableName
	}

	toJSON() {
		return JSON.stringify(this.object);
	}

	toString() {
		return JSON.stringify(this.object);
	}

	/**
	 * Validate data against this schema
	 * @param data
	 * @param action
	 * @returns {*[]|boolean}
	 */
	validateObject(data, action) {
		return validateAgainstSchema.validateObject(data, this, action);
	}

	/**
	 * @param key
	 * @param value
	 * @param action
	 * @returns {{error: {property: *, message: *[], value: *, key: *}}|boolean}
	 */
	validateProperty(key, value, action) {
		return validateAgainstSchema.validateKey(key, value, this, action);
	}
}

module.exports = JsonSchema;
