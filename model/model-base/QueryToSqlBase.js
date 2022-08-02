const _ = require("lodash");
const moment = require("moment-timezone");
const uuid = require("node-uuid");
const inflector = require("../../helper/inflector");
const knex = require("knex")
const sqlString = require("sqlstring");
const getModel = require("../../helper/get-model");

class QueryToSqlBase {

	/**
	 * @param {ModelBase} model
	 */
	constructor(model) {
		this.model = model;
		if (!this.model.properties) {
			console.log(this.model);
			throw new Error("Please pass in properties to builder -> " + this.model.constructor.name);
		}
		if (!this.model.tableName) {
			console.log(this.model);
			throw new Error("Please pass in tableName to builder -> " + this.model.constructor.name);
		}
	}

	get properties() {
		return this.model.properties;
	}

	get tableName() {
		return this.model.tableName;
	}

	get primaryKey() {
		return this.model.primaryKey;
	}

	/**
	 * @returns {JsonSchema}
	 */
	get schema() {
		return this.model.schema;
	}

	get defaultSort() {
		if (this.model.defaultSort) {
			return this.model.defaultSort;
		}
		return this.model.primaryKey + " ASC";
	}

	get relations() {
		return this.model.relations;
	}

	loadModel(model) {
		if (typeof model !== "string") {
			return model;
		}
		return getModel(model);
	}

	/**
	 * @returns {string[]}
	 */
	get keywords() {
		return ['sort', 'select', 'skip', 'offset', 'limit', 'join', 'count'];
	}

	/**
	 * @returns {string}
	 */
	get like() {
		return "ilike";
	}

	/**
	 * @returns {string}
	 */
	get client() {
		return "pg";
	}

	/**
	 * @returns {QueryBuilder}
	 */
	get qb() {
		this._queryBuilder = knex(
			{
				client: this.client,
				/**
				 * convert camelCase to snake_case. Note: wrap command in knex.raw() if you don't want this to happen
				 * @param value
				 * @param origImpl
				 * @param queryContext
				 * @returns {*}

				wrapIdentifier: (value, origImpl, queryContext) => {
					if (value.indexOf("_") === -1) {
						//console.log(value + " => " + inflector.underscore(value));
						if (value !== this.tableName) {
							if (!process.env.IGNORE_CASE) {
								//TODO check env to see what kind of inflection to use
								value = inflector.underscore(value);
							}
						}
					}
					return origImpl(value);
				}
				 */
			}
		)(this.tableName);
		return this._queryBuilder;
	}

	/**
	 * @param value
	 * @returns {*|Knex.Raw<any>}
	 */
	knexRaw(value) {
		return this.raw(value);
	}

	/**
	 * @param value
	 * @returns {Knex.Raw<any>}
	 */
	raw(value) {
		return knex(
			{
				client: this.client
			}
		).raw(value);
	}


	/**
	 * Generate SQL select statement
	 * @param query
	 * @returns {*}
	 */
	async select(query) {

		let q = _.clone(query);

		let queryBuilder = this.qb;
		let selects = [];
		let context = this;

		if (q.select) {
			q.select = typeof q.select === "string" ? q.select.split(',') : q.select;
			for (let i = 0; i < q.select.length; i++) {
				let key = q.select[i];
				if (this.properties.hasOwnProperty(key)) {
					selects.push(this.buildSelect(key));
				} else if (key && key.indexOf(".") !== -1) {
					key = key.split(".");
					let column = key[0];
					key.shift();
					if (this.properties[column]) {
						selects.push(this.buildSelect(column, key));
					}
				}
			}
		}

		if (selects.length === 0 || !q.select) {
			for (let key in this.properties) {
				if (this.properties[key] !== undefined) {
					selects.push(this.buildSelect(key));
				}
			}
		}

		delete q.select;

		selects.forEach(
			function (item) {
				if (item) {
					queryBuilder.select(context.addSelect(item));
				}
			}
		);

		let hasSkip = false;
		let hasSort = false;

		if (!q.sort) {
			q.sort = this.defaultSort;
		}

		for (let key in q) {

			if (q[key] === "") {
				continue;
			}

			q[key] = this.decodeQuery(q[key]);

			switch (key) {
				case "skip" :
				case "offset" :
					queryBuilder.offset(parseInt(q[key]));
					hasSkip = true;
					break;
				case "limit" :
					if (!isNaN(parseInt(q[key]))) {
						queryBuilder.limit(parseInt(q[key]));
					}
					break;
				case "sort" :
					//TODO support array sort
					let terms = Array.isArray(q.sort) ? q.sort : q[key].split(",");
					let context = this;
					terms.forEach(
						function (term) {
							if (!term) {
								return;
							}
							let params = term.split(" ");
							let direction = "ASC";
							if (params.length > 1) {
								if (params[1].toLowerCase() === "desc") {
									direction = "DESC";
								}
							}
							let sort = context.buildSort(params[0], direction);
							if (sort) {
								queryBuilder.orderBy(sort, direction);
								hasSort = true;
							}
						}
					);

					break;
				case "select" :
					break;
			}
		}

		if (!hasSort) {
			if (this.client === "mssql") { //On SQL Server, Offset doesn't work without ORDER BY
				queryBuilder.orderBy(this.properties[this.getDefaultSortKey()].columnName, "ASC");
			}
		}

		await this.parseQuery(query, queryBuilder);
		return {
			queryBuilder : queryBuilder,
			statement : queryBuilder.toString()
		};
	}

	addSelect(item) {
		return this.raw(item)
	}

	buildSelect(key, subKey) {
		let query = `"${this.tableName}"."${this.properties[key].columnName}" as "${key}"`;
		if (this.client === "mysql") {
			query = query.split('"').join('`')
		}
		return this.knexRaw(query);
	}

	buildSort(propertyName) {
		if (this.properties[propertyName]) {
			let query = '"' + this.tableName + '"."' + this.properties[propertyName].columnName + '"';
			if (this.client === "mysql") {
				query = query.split('"').join('`')
			}
			return this.knexRaw(query);
		}
		return null;
	}

	/**
	 * @param query
	 * @returns {*}
	 */
	async count(query) {
		let queryBuilder = this.qb;
		query = _.clone(query);
		await this.parseQuery(query, queryBuilder);
		//return builder.count("*");
		//TODO support count by composite key
		let columnName = this.properties[this.getPrimaryKey()].columnName;
		queryBuilder.count(this.column(columnName));
		return {
			queryBuilder : queryBuilder,
			statement : queryBuilder.toString()
		};
	}

	/**
	 * General sqlBuilder update statement
	 * @param {Object} query
	 * @param {Object} data - the data to insert
	 * @returns {*}
	 */

	//this.this.tableName, query, data, this.properties
	async update(query, data) {

		query = _.clone(query);
		let queryBuilder = this.qb;
		await this.parseQuery(query, queryBuilder);
		let transform = {};

		//TODO should data have been validated before this? Seems like it
		Object.keys(data).forEach(
			(key) => {
				if (this.properties[key]) {
					transform[this.properties[key].columnName] = this.processType(data[key], this.properties[key], true);
				} else {
					console.log("Not adding " + key);
				}
			}
		);

		queryBuilder.update(transform);
		return {
			queryBuilder : queryBuilder,
			statement : queryBuilder.toString()
		};
	}

	//this.tableName, query, data, this.properties
	async delete(query) {
		let queryBuilder = this.qb;
		query = _.clone(query);
		await this.parseQuery(query, queryBuilder);
		queryBuilder.delete();
		return {
			queryBuilder : queryBuilder,
			statement : queryBuilder.toString()
		};
	}

	/**
	 * @param data
	 * @returns {*}
	 */
	async insert(data) {
		let queryBuilder = this.qb;
		let translation = {};
		let required = _.clone(this.schema.required);

		if (this.primaryKey) {
			if (!data[this.primaryKey]) {
				if (this.properties[this.primaryKey].type === "string" && this.properties[this.primaryKey].format === "uuid") {
					data[this.primaryKey] = uuid.v4();
				}
			}
		}

		//TODO should data have been validated before this? Seems like it
		for (let key in data) {
			if (this.properties[key]) {
				//does final json conversion as needed
				translation[this.properties[key].columnName] = this.processType(data[key], this.properties[key], true);
			}
			let index = _.indexOf(required, key);
			if (index !== -1) {
				required.splice(index, 1);
			}
		}

		if (required.length > 0) {
			//console.log(data);
			return {
				error: required,
				message: "Missing or Invalid Fields"
			}
		}

		queryBuilder.insert(translation);

		return {
			queryBuilder : queryBuilder,
			statement : queryBuilder.toString()
		};
	}

	/**
	 * A query to sqlBuilder conversion manager
	 * @param {Object} query
	 * @param [queryBuilder]
	 * @returns {*}
	 */
	async parseQuery(query, queryBuilder) {
		//TODO support complex or conditions

		if (!query) {
			return queryBuilder;
		}

		let queryParams;

		if (query.where) {
			queryParams = _.isString(query.where) ? JSON.parse(query.where) : query.where;
		} else {
			queryParams = query;
		}

		for (let key in queryParams) {
			if (this.keywords.includes(key)) {
				continue;
			}

			let compare = "";
			let value;

			if (query[key] === "") {
				continue;
			}

			if (typeof queryParams[key] === "object") {
				if (key === "and" || key === "or") {
					compare = key;
				} else {
					if (queryParams[key] && typeof queryParams[key] === "object") {
						compare = Object.keys(queryParams[key])[0]; //formed as {param:{"compare":"value"}
					} else {
						compare = "=="; //formed as {param : value} which is an implied ==
					}
				}
			}

			if (compare !== "" && compare !== "or" && compare !== "and") {
				value = queryParams[key] ? queryParams[key][compare] : queryParams[key];
			} else {
				value = queryParams[key];
			}

			await this.processCompare(key, compare, value, queryBuilder);

		}


		//return builder;
	}

	/**
	 *
	 * @param {string} key - the field key
	 * @param {string} compare - the comparitor, gt, >, < lt, !, != etc
	 * @param {*} value - the string, array, number, etc
	 * @param {Object} queryBuilder - the current knex builder
	 * @param {boolean} [isOr]
	 */
	async processCompare(key, compare, value, queryBuilder, isOr) {

		let columnName;
		let columnFormat = null;

		if (key.indexOf(".") !== -1 || _.isObject(key)) { //JSONB Syntax
			return this.processObjectColumn(key, compare, value, queryBuilder, isOr)
		}

		if (this.properties[key] && this.properties[key].columnName) {
			columnName = this.properties[key].columnName;
			let columnType = this.properties[key].type;
			columnFormat = this.properties[key].format;
			if (columnType === "array") {
				return this.processArrayColumn(key, compare, value, queryBuilder, isOr)
			}
		} else if (this.relations[key]) {
			//exists true|false
			return await this.processRelation(key, compare, value, queryBuilder, isOr);
		} else if (key !== "or" && key !== "and") {
			return;
		}

		let c = {
			where: "where",
			whereIn: "whereIn",
			whereNotIn: "whereNotIn",
			whereNull: "whereNull",
			whereNot: "whereNot",
			whereNotNull: "whereNotNull",
			whereNotExists : "whereNotExists",
			whereExists : "whereExists"
		}

		if (isOr) {
			c = {
				where: "orWhere",
				whereIn: "orWhereIn",
				whereNotIn: "orWhereNotIn",
				whereNull: "orWhereNull",
				whereNot: "orWhereNot",
				whereNotNull: "orWhereNotNull"
			}
		}

		switch (compare) {
			case "inside" :
			case "near" :
			case "radius" :
			case "poly" :
			case "geohash" :
			case "box" :
				//TODO integrate geo query functions
				break;
			case "gt" :
			case ">" :
				queryBuilder[c.where](this.column(columnName), ">", this.processType(value, this.properties[key]));
				break;
			case "gte" :
			case ">=" :
				queryBuilder[c.where](this.column(columnName), ">=", this.processType(value, this.properties[key]));
				break;
			case "lt" :
			case "<" :
				queryBuilder[c.where](this.column(columnName), "<", this.processType(value, this.properties[key]));
				break;
			case "lte" :
			case "<=" :
				queryBuilder[c.where](this.column(columnName), "<=", this.processType(value, this.properties[key]));
				break;
			case "in" :
				queryBuilder[c.whereIn](this.column(columnName), this.processArrayType(value, this.properties[key]));
				break;
			case "nin" :
				queryBuilder[c.whereNotIn](this.column(columnName), this.processArrayType(value, this.properties[key]));
				break;
			case "endsWith" :
				queryBuilder[c.where](this.processEndsWith(key, value));
				break;
			case "startsWith" :
				queryBuilder[c.where](this.processStartsWith(key, value));
				break;
			case "contains" :
			case "like" :
				queryBuilder[c.where](this.processContains(key, value));
				break;
			case "=" :
			case "==" :
			case "eq" :
				if (value === null) {
					queryBuilder[c.whereNull](this.column(columnName));
				} else if (Array.isArray(value)) {
					queryBuilder[c.whereIn](this.column(columnName), this.processArrayType(value, this.properties[key]));
				} else {
					queryBuilder[c.where](this.column(columnName), this.processType(value, this.properties[key]));
				}

				break;
			case "!" :
			case "!=" :
			case "ne" :
				if (value === null) {
					queryBuilder[c.whereNotNull](this.column(columnName));
				} else if (Array.isArray(value)) {
					queryBuilder[c.whereNotIn](this.column(columnName), this.processArrayType(value, this.properties[key]));
				} else {
					queryBuilder[c.whereNot](this.column(columnName), this.processType(value, this.properties[key]));
				}
				break;
			case "or" :
			case "and" :
				/**
				 * or : [
				 *  {field1: val1},
				 *  {field2 {">":val2}
				 * ]
				 */

				isOr = compare === "or";

				queryBuilder.where(
					(builder) => {
						for (let i = 0; i < value.length; i++) {

							if (Array.isArray(value[i])) {
								/*
								or / and : [
									[
										{field1: "value"},
										{field2: null},
									],
									[
										{field3: "value"},
										{field4: null}
									]
								]

								will make
								(field1 = value or field2 is null) and
								(field3 = value and field4 is null)
								 */
								this.processCompare(isOr ? "or" : "and", isOr ? "or" : "and", value[i], builder);
							} else {
								/*
								or : [
									{field1: value},
									{field2: null}
								]
								will make
								(field1 = value or field2 is null)
								 */
								let innerCompare = "";
								let innerValue;
								let innerKey = Object.keys(value[i])[0]; //{field:{}}

								if (value[i][innerKey] && typeof value[i][innerKey] === "object") {
									innerCompare = Object.keys(value[i][innerKey])[0];
								}

								if (innerCompare !== "") {
									innerValue = value[i][innerKey][innerCompare];
								} else {
									innerValue = value[i][innerKey];
								}
								this.processCompare(innerKey, innerCompare, innerValue, builder, isOr);
							}
						}
					}
				);
				break;
			default :
				return this.processCompare(key, "==", value, queryBuilder, isOr);
		}
	}

	/**
	 * Allows for
	 * @param {string} key - the field key
	 * @param {string} compare - the comparitor, gt, >, < lt, !, != etc
	 * @param {*} value - the string, array, number, etc
	 * @param {Object} queryBuilder - the current knex builder
	 * @param {boolean} [isOr]
	 */
	async processRelation(key, compare, value, queryBuilder, isOr) {

		let relation = this.model.relations[key];
		let RelationModel = this.loadModel(relation.model);
		if (!RelationModel) {
			return ;
		}
		let relationModel = new RelationModel(this.model.req);

		switch (compare) {
			case "exists" :
				let from = this.properties[relation.join.from].columnName;
				let to = relationModel.properties[relation.join.to].columnName;
				let context = this;
				queryBuilder[value === true ? "whereExists" : "whereNotExists"](
					() => {
						let condition = `"${context.model.tableName}"."${from}" = "${relationModel.tableName}"."${to}"`;
						if (context.client === "mysql") {
							condition = condition.split('"').join("`");
						}
						console.log(condition);
						this.select("*").from(relationModel.tableName).whereRaw(condition)
					}
				);
				break;
		}
	}
	/**
	 * Process a json column. pretty much just postgres right now
	 * @param {string} key
	 * @param {string} compare
	 * @param {*} value
	 * @param {knex} queryBuilder
	 * @param {boolean} [isOr]
	 */
	processObjectColumn(key, compare, value, queryBuilder, isOr) {
		//TODO Figure this out for MYSQL
	}

	/**
	 * Append tableName to column to stop ambiguity. For MySQL
	 * @param column
	 * @returns {*|Knex.Raw<any>}
	 */
	column(column) {
		if (this.client === "mysql") {
			return this.raw('`' + this.tableName + '`.`' + column + '`');
		} else {
			return this.raw('"' + this.tableName + '"."' + column + '"');
		}
	}

	/**
	 * Return primaryKey if set (really should have one, but legacy DB's don't always, and neither do views)
	 * @returns {string|*}
	 */
	getPrimaryKey() {
		if (this.primaryKey && this.properties[this.primaryKey]) {
			return this.primaryKey;
		}
		return Object.keys(this.properties)[0];
	}

	/**
	 * Try to find some default to sort on. Sorting on a UUID doesn't seem to make much sense, so maybe a timestamp???
	 * @returns {string|*}
	 */
	getDefaultSortKey() {
		if (this.primaryKey && this.properties[this.primaryKey]) {
			if (this.properties[this.primaryKey].type === "number") {
				return this.primaryKey;
			}
			if (this.properties[this.primaryKey].type === "string") {
				return this.primaryKey;
			}
		}

		for (let key in this.properties) {
			if (this.properties.format === "date" || this.properties.format === "date-time") {
				return key;
			}

			let parts = inflector.underscore(this.properties[key].columnName.toLowerCase()).split("_");
			if (parts[parts.length - 1] === "id" || parts[parts.length - 1] === "number") {
				return key;
			}

			if (parts[parts.length - 1] === "date") {
				return key;
			}
		}

		return Object.keys(this.properties)[0];
	}

	/**
	 * Process a JSONB Column
	 * @param key
	 * @param compare
	 * @param value
	 * @param queryBuilder
	 */
	processArrayColumn(key, compare, value, queryBuilder) {
		//TODO Mysql should split the do
		//and / or / matches one
	}

	/**
	 * decode funny query string values
	 * @param query
	 * @returns {string}
	 */
	decodeQuery(query) {
		return decodeURI(query).split("/").join("\/");
	}

	/**
	 * Incoming values are pretty much all going to be strings, so let's parse that out to be come correct types
	 * @param value
	 * @param {Object} key - a single json schema property
	 * @returns {*}
	 */
	processType(value, key) {
		if (this.properties[key] && this.properties[key].type === "string") {

		}
		return value;
	}

	/**
	 * Where in, nin conditions are present, the options need to be parsed to the correct data-type
	 * @param {string|array} list - a string is array of values. string should be comma separated
	 * @param {Object} property - a singular item in json schema
	 * @returns {Array}
	 */
	processArrayType(list, property) {
		let context = this;
		if (!Array.isArray(list)) {
			list = list.split(",");
		}
		var valueList = [];
		list.forEach(
			function (item) {
				let v = context.processType(item, property);
				if (v) {
					valueList.push(v);
				}
			}
		);

		return valueList;
	}

	processContains(key, value) {
		let columnName = this.properties[key].columnName;
		return this.raw(`"${this.tableName}"."${columnName}" LIKE ${sqlString.escape("%" + value + "%")}`)
	}

	processStartsWith(key, value) {
		let columnName = this.properties[key].columnName;
		return this.raw(`"${this.tableName}"."${columnName}" LIKE ${sqlString.escape(value + "%")}`)
	}

	processEndsWith(key, value) {
		let columnName = this.properties[key].columnName;
		return this.raw(`"${this.tableName}"."${columnName}" LIKE ${sqlString.escape("%" + value)}`)
	}

	sqlFormatArray(values, type) {
		let output = [];
		switch (type) {
			case "string" :
				values.forEach(
					(value) => {
						output.push(sqlString.escape(value))
					}
				)
				break;
			case "int" :
			case "integer" :
				values.forEach(
					(value) => {
						output.push(parseInt(value))
					}
				);
				break;
			case "decimal" :
			case "number" :
				values.forEach(
					(value) => {
						output.push(parseFloat(value))
					}
				)
				break;
		}
		return output.join(",")
	}
}

module.exports = QueryToSqlBase;