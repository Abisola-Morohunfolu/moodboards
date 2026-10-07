import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';

// QueryBuilder RETURNING and SQL queries contain database column names, not
// hydrated entities. Reuse the registered driver mappings at this boundary.
export function entityFromRow<T extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<T>,
  row: Record<string, unknown>,
): T {
  const metadata = manager.connection.getMetadata(target);
  const entity = metadata.create();
  for (const column of metadata.columns) {
    if (Object.hasOwn(row, column.databaseName)) {
      column.setEntityValue(
        entity,
        manager.connection.driver.prepareHydratedValue(row[column.databaseName], column),
      );
    }
  }
  return entity as T;
}
