import { Knex } from 'knex';
import { Query, Filter, Relation, SchemaOverview } from '../types';
import { clone, isPlainObject, get, set } from 'lodash';
import { systemRelationRows } from '../database/system-data/relations';
import { customAlphabet } from 'nanoid';
import getLocalType from './get-local-type';
import validate from 'uuid-validate';

const generateAlias = customAlphabet('abcdefghijklmnopqrstuvwxyz', 5);

export default function applyQuery(
	collection: string,
	dbQuery: Knex.QueryBuilder,
	query: Query,
	schema: SchemaOverview,
	subQuery: boolean = false
) {
	if (query.sort) {
		dbQuery.orderBy(
			query.sort.map((sort) => ({
				...sort,
				column: `${collection}.${sort.column}`,
			}))
		);
	}

	if (typeof query.limit === 'number') {
		dbQuery.limit(query.limit);
	}

	if (query.offset) {
		dbQuery.offset(query.offset);
	}

	if (query.page && query.limit) {
		dbQuery.offset(query.limit * (query.page - 1));
	}

	if (query.single) {
		dbQuery.limit(1).first();
	}

	if (query.filter) {
		applyFilter(schema, dbQuery, query.filter, collection, subQuery);
	}

	if (query.search) {
		applySearch(schema, dbQuery, query.search, collection);
	}
}

export function applyFilter(
	schema: SchemaOverview,
	rootQuery: Knex.QueryBuilder,
	rootFilter: Filter,
	collection: string,
	subQuery: boolean = false
) {
	const relations: Relation[] = [...schema.relations, ...systemRelationRows];

	const aliasMap: Record<string, string> = {};

	addJoins(rootQuery, rootFilter, collection);
	addWhereClauses(rootQuery, rootFilter, collection);

	function addJoins(dbQuery: Knex.QueryBuilder, filter: Filter, collection: string) {
		for (const [key, value] of Object.entries(filter)) {
			if (key === '_or' || key === '_and') {
				// If the _or array contains an empty object (full permissions), we should short-circuit and ignore all other
				// permission checks, as {} already matches full permissions.
				if (key === '_or' && value.some((subFilter: Record<string, any>) => Object.keys(subFilter).length === 0))
					continue;

				value.forEach((subFilter: Record<string, any>) => {
					addJoins(dbQuery, subFilter, collection);
				});

				continue;
			}

			const filterPath = getFilterPath(key, value);

			if (filterPath.length > 1) {
				addJoin(filterPath, collection);
			}
		}

		function addJoin(path: string[], collection: string) {
			path = clone(path);

			followRelation(path);

			function followRelation(pathParts: string[], parentCollection: string = collection, parentAlias?: string) {
				const relation = relations.find((relation) => {
					return (
						(relation.many_collection === parentCollection && relation.many_field === pathParts[0]) ||
						(relation.one_collection === parentCollection && relation.one_field === pathParts[0])
					);
				});

				if (!relation) return;

				const isM2O = relation.many_collection === parentCollection && relation.many_field === pathParts[0];

				const alias = generateAlias();

				set(aliasMap, parentAlias ? [parentAlias, ...pathParts] : pathParts, alias);

				if (isM2O) {
					dbQuery.leftJoin(
						{ [alias]: relation.one_collection! },
						`${parentAlias || parentCollection}.${relation.many_field}`,
						`${alias}.${relation.one_primary}`
					);
				}

				if (subQuery === true && isM2O === false) {
					dbQuery.leftJoin(
						{ [alias]: relation.many_collection },
						`${parentAlias || parentCollection}.${relation.one_primary}`,
						`${alias}.${relation.many_field}`
					);
				}

				if (isM2O || subQuery === true) {
					pathParts.shift();

					const parent = isM2O ? relation.one_collection! : relation.many_collection;

					if (pathParts.length) {
						followRelation(pathParts, parent, alias);
					}
				}
			}
		}
	}

	function addWhereClauses(
		dbQuery: Knex.QueryBuilder,
		filter: Filter,
		collection: string,
		logical: 'and' | 'or' = 'and'
	) {
		for (const [key, value] of Object.entries(filter)) {
			if (key === '_or' || key === '_and') {
				// If the _or array contains an empty object (full permissions), we should short-circuit and ignore all other
				// permission checks, as {} already matches full permissions.
				if (key === '_or' && value.some((subFilter: Record<string, any>) => Object.keys(subFilter).length === 0))
					continue;

				/** @NOTE this callback function isn't called until Knex runs the query */
				dbQuery[logical].where((subQuery) => {
					value.forEach((subFilter: Record<string, any>) => {
						addWhereClauses(subQuery, subFilter, collection, key === '_and' ? 'and' : 'or');
					});
				});

				continue;
			}

			const filterPath = getFilterPath(key, value);
			const { operator: filterOperator, value: filterValue } = getOperation(key, value);

			const o2mRelation = relations.find((relation) => {
				return relation.one_collection === collection && relation.one_field === filterPath[0];
			});

			if (!!o2mRelation && subQuery === false) {
				const pkField = `${collection}.${o2mRelation.one_primary}`;

				dbQuery[logical].whereIn(pkField, (subQueryKnex) => {
					subQueryKnex.select([o2mRelation.many_field]).from(o2mRelation.many_collection);

					applyQuery(
						o2mRelation.many_collection,
						subQueryKnex,
						{
							filter: value,
						},
						schema,
						true
					);
				});
			} else {
				if (filterPath.length > 1) {
					const columnName = getWhereColumn(filterPath, collection);
					if (!columnName) continue;
					applyFilterToQuery(columnName, filterOperator, filterValue, logical);
				} else {
					applyFilterToQuery(`${collection}.${filterPath[0]}`, filterOperator, filterValue, logical);
				}
			}
		}

		function applyFilterToQuery(key: string, operator: string, compareValue: any, logical: 'and' | 'or' = 'and') {
			if (operator === '_eq') {
				dbQuery[logical].where({ [key]: compareValue });
			}

			if (operator === '_neq') {
				dbQuery[logical].whereNot({ [key]: compareValue });
			}

			if (operator === '_contains') {
				dbQuery[logical].where(key, 'like', `%${compareValue}%`);
			}

			if (operator === '_ncontains') {
				dbQuery[logical].whereNot(key, 'like', `%${compareValue}%`);
			}

			if (operator === '_gt') {
				dbQuery[logical].where(key, '>', compareValue);
			}

			if (operator === '_gte') {
				dbQuery[logical].where(key, '>=', compareValue);
			}

			if (operator === '_lt') {
				dbQuery[logical].where(key, '<', compareValue);
			}

			if (operator === '_lte') {
				dbQuery[logical].where(key, '<=', compareValue);
			}

			if (operator === '_in') {
				let value = compareValue;
				if (typeof value === 'string') value = value.split(',');

				let flattened = [].concat(...value);
				let flattenedUnique = [...new Set(flattened)];

				dbQuery[logical].whereIn(key, flattenedUnique as string[]);
			}

			if (operator === '_nin') {
				let value = compareValue;
				if (typeof value === 'string') value = value.split(',');

				let flattened = [].concat(...value);
				let flattenedUnique = [...new Set(flattened)];

				dbQuery[logical].whereNotIn(key, flattenedUnique as string[]);
			}

			if (operator === '_null' || (operator === '_nnull' && compareValue === false)) {
				dbQuery[logical].whereNull(key);
			}

			if (operator === '_nnull' || (operator === '_null' && compareValue === false)) {
				dbQuery[logical].whereNotNull(key);
			}

			if (operator === '_empty' || (operator === '_nempty' && compareValue === false)) {
				dbQuery[logical].andWhere((query) => {
					query.whereNull(key);
					query.orWhere(key, '=', '');
				});
			}

			if (operator === '_nempty' || (operator === '_empty' && compareValue === false)) {
				dbQuery[logical].andWhere((query) => {
					query.whereNotNull(key);
					query.orWhere(key, '!=', '');
				});
			}

			if (operator === '_between') {
				let value = compareValue;
				if (typeof value === 'string') value = value.split(',');

				dbQuery[logical].whereBetween(key, value);
			}

			if (operator === '_nbetween') {
				let value = compareValue;
				if (typeof value === 'string') value = value.split(',');

				dbQuery[logical].whereNotBetween(key, value);
			}
		}

		function getWhereColumn(path: string[], collection: string) {
			path = clone(path);

			return followRelation(path);

			function followRelation(
				pathParts: string[],
				parentCollection: string = collection,
				parentAlias?: string
			): string | void {
				const relation = relations.find((relation) => {
					return (
						(relation.many_collection === parentCollection && relation.many_field === pathParts[0]) ||
						(relation.one_collection === parentCollection && relation.one_field === pathParts[0])
					);
				});

				if (!relation) return;

				const isM2O = relation.many_collection === parentCollection && relation.many_field === pathParts[0];
				const alias = get(aliasMap, parentAlias ? [parentAlias, ...pathParts] : pathParts);

				const remainingParts = pathParts.slice(1);

				const parent = isM2O ? relation.one_collection! : relation.many_collection;

				if (remainingParts.length === 1) {
					return `${alias || parent}.${remainingParts[0]}`;
				}

				if (remainingParts.length) {
					return followRelation(remainingParts, parent, alias);
				}
			}
		}
	}
}

export async function applySearch(
	schema: SchemaOverview,
	dbQuery: Knex.QueryBuilder,
	searchQuery: string,
	collection: string
) {
	const columns = Object.values(schema.tables[collection].columns);

	dbQuery.andWhere(function () {
		columns
			.map((column) => ({
				...column,
				localType: getLocalType(column),
			}))
			.forEach((column) => {
				if (['text', 'string'].includes(column.localType)) {
					this.orWhereRaw(`LOWER(??) LIKE ?`, [
						`${column.table_name}.${column.column_name}`,
						`%${searchQuery.toLowerCase()}%`,
					]);
				} else if (['bigInteger', 'integer', 'decimal', 'float'].includes(column.localType)) {
					const number = Number(searchQuery);
					if (!isNaN(number)) this.orWhere({ [`${column.table_name}.${column.column_name}`]: number });
				} else if (column.localType === 'uuid' && validate(searchQuery)) {
					this.orWhere({ [`${column.table_name}.${column.column_name}`]: searchQuery });
				}
			});
	});
}

function getFilterPath(key: string, value: Record<string, any>) {
	const path = [key];

	if (typeof Object.keys(value)[0] === 'string' && Object.keys(value)[0].startsWith('_') === true) {
		return path;
	}

	if (isPlainObject(value)) {
		path.push(...getFilterPath(Object.keys(value)[0], Object.values(value)[0]));
	}

	return path;
}

function getOperation(key: string, value: Record<string, any>): { operator: string; value: any } {
	if (key.startsWith('_') && key !== '_and' && key !== '_or') {
		return { operator: key as string, value };
	} else if (isPlainObject(value) === false) {
		return { operator: '_eq', value };
	}

	return getOperation(Object.keys(value)[0], Object.values(value)[0]);
}
