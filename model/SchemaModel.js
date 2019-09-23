const ModelBase = require('./ModelBase');
const _ = require('lodash');
const inflector = require("../helper/inflector");
const schema = require('../schema/schemas-schema');
const fields = require('../schema/fields/schemas-fields');
const cache = require("../helper/cache-manager");
const md5 = require("md5");
const connectionStringParser = require("../helper/connection-string-parser");
let schemaModel;
let knex = require("knex");
let fs = require("fs");

module.exports = class SchemaModel extends ModelBase {

	constructor(req) {
		super(req);
		this.tableExists = null;
	}

	get connectionString() {
		return process.env.DEFAULT_DB;
	}

	get tableName() {
		return SchemaModel.tableName;
	}

	static get tableName() {
		return "_schemas";
	}

	static get schema() {
		if (global.schemaCache && global.schemaCache[SchemaModel.tableName]) {
			return global.schemaCache[SchemaModel.tableName]
		}
		return require('../schema/schemas-schema');
	}

	static get fields() {
		if (global.fieldCache && global.fieldCache[SchemaModel.tableName]) {
			return global.fieldCache[SchemaModel.tableName];
		}
		return require('../schema/fields/schemas-fields');
	}

	get schema() {
		return SchemaModel.schema;
	}

	get fields() {
		return SchemaModel.fields;
	}

	async index(query) {
		query.sort = "title ASC";
		return await super.index(query);
	}

	async create(data) {
		return await super.create(data);
	}

	async read(id, query) {
		return await super.read(id, query);
	}

	async update(id, data, query) {
		return await super.update(id, data, query);
	}

	async query(query) {
		query.sort = "title ASC";
		return await super.query(query);
	}

	async destroy(id) {
		return await super.destroy(id);
	}

	async loadSchemas(connectionStrings) {

		global.schemaCache = global.schemaCache || {};

		if (!_.isArray(connectionStrings)) {
			connectionStrings = [connectionStrings];
		}

		let dataSources = [];
		let count = 0;

		connectionStrings.forEach(
			function (item) {
				if (item.indexOf("://") === -1) {
					dataSources.push(item);
				} else {
					let cs = connectionStringParser(item);
					dataSources.push(cs.database);
				}
			}
		);

		let hasTable = await this.hasTable();
		if (hasTable) {

			let results = await this.find({where: {dataSource: {"in": dataSources}}});

			//TODO we really need to have a key that is datasource_tablename;

			results.forEach(
				function (item) {
					global.schemaCache[item.tableName] = item;
				}
			);
		} else {
			let files = fs.readdirSync(global.appRoot + '/src/schema');
			files.forEach(
				function(file) {
					if (file.indexOf(".js") === -1) {
						return;
					}
					let tableName = inflector.dasherize(file.split("-schema.js").join(""));
					global.schemaCache[tableName] = require(global.appRoot + '/src/schema/' + file);
					count++;
				}
			);
		}

		console.log("Loaded " + Object.keys(global.schemaCache).length + " schemas");
	}

	async hasTable() {
		//TODO can this be done with knex.
		if (this.tableExists === null) {
			let builder = this.queryBuilder;
			let query = knex(
				{
					client: this.queryBuilder.client,
				}
			);
			let exists = await this.execute(query.schema.hasTable("_schemas"));
			//console.log("Schema has table");
			//console.log(exists);
			this.tableExists = exists.length > 0;
		}
		return this.tableExists;
	}

	async get(tableName, fromCache) {

		global.schemaCache = global.schemaCache || {};
		if (fromCache !== false) {
			if (global.schemaCache[tableName]) {
				return global.schemaCache[tableName];
			}
		}

		let result = await this.find(
			{
				where: {
					tableName: tableName
				}
			}
		);

		if (result.length === 1) {
			global.schemaCache[tableName] = result[0];
			return result[0];
		}
		return null;

	}

	async set(tableName, data) {
		let table = await this.get(tableName, false);
		if (table) {
			return await this.update(table.id, data);
		} else {
			let hasTable = await this.hasTable();
			if (hasTable) {
				table = await this.create(data);
				if (table.error) {
					console.log("schema set error " + table.error);
				} else {
					console.log(tableName + " created");
					await cache.set("schema_" + tableName, table);
				}
				return table;
			}
		}
	}

	async createTable() {
		//TODO need to do this for mssql and mysql as well
		await this.execute(
			'drop table _schemas;\n' +
			'create table "_schemas"\n' +
			'(\n' +
			'  id          uuid        not null\n' +
			'    constraint schemas_pkey\n' +
			'    primary key,\n' +
			'  data_source varchar(64),\n' +
			'  title       varchar(255),\n' +
			'  table_name  varchar(64) not null,\n' +
			'  primary_key varchar(64) default \'id\' :: character varying,\n' +
			'  properties  jsonb       not null,\n' +
			'  required    varchar(64) [],\n' +
			'  read_only   varchar(64) [],\n' +
			'  created_at  timestamp   default now(),\n' +
			'  updated_at  timestamp   default now()\n' +
			');\n' +
			'\n' +
			'create unique index schemas_id_uindex\n' +
			'  on "_schemas" (id);\n' +
			'\n' +
			'create unique index schemas_table_name_uindex\n' +
			'  on "_schemas" (table_name);\n' +
			'\n'
		)
	}

}