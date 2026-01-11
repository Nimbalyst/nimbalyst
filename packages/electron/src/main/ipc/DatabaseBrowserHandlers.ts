import { safeHandle } from '../utils/ipcRegistry';
import { database } from '../database/initialize';

export function registerDatabaseBrowserHandlers() {
    // Get list of all tables in the database
    safeHandle('database:getTables', async () => {
        try {
            const result = await database.query<{ tablename: string }>(
                `SELECT tablename FROM pg_catalog.pg_tables
                 WHERE schemaname = 'public'
                 ORDER BY tablename`
            );
            return { success: true, tables: result.rows.map(r => r.tablename) };
        } catch (error) {
            console.error('[DatabaseBrowserHandlers] Error fetching tables:', error);
            return { success: false, error: String(error) };
        }
    });

    // Get table schema (columns and types)
    safeHandle('database:getTableSchema', async (event, tableName: string) => {
        try {
            const result = await database.query<{
                column_name: string;
                data_type: string;
                is_nullable: string;
                column_default: string | null;
            }>(
                `SELECT column_name, data_type, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = $1
                 ORDER BY ordinal_position`,
                [tableName]
            );
            return { success: true, columns: result.rows };
        } catch (error) {
            console.error('[DatabaseBrowserHandlers] Error fetching table schema:', error);
            return { success: false, error: String(error) };
        }
    });

    // Get table data with pagination and sorting
    safeHandle('database:getTableData', async (event, tableName: string, limit: number = 100, offset: number = 0, sortColumn?: string, sortDirection?: 'asc' | 'desc') => {
        try {
            // Get total count
            const countResult = await database.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM ${tableName}`
            );
            const totalCount = parseInt(countResult.rows[0].count);

            // Build ORDER BY clause if sorting is specified
            let orderByClause = '';
            if (sortColumn) {
                // Sanitize column name to prevent SQL injection
                const sanitizedColumn = sortColumn.replace(/[^a-zA-Z0-9_]/g, '');
                const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';
                orderByClause = ` ORDER BY "${sanitizedColumn}" ${direction} NULLS LAST`;
            }

            // Get paginated data with optional sorting
            const dataResult = await database.query(
                `SELECT * FROM ${tableName}${orderByClause} LIMIT $1 OFFSET $2`,
                [limit, offset]
            );

            return {
                success: true,
                rows: dataResult.rows,
                totalCount,
                limit,
                offset
            };
        } catch (error) {
            console.error('[DatabaseBrowserHandlers] Error fetching table data:', error);
            return { success: false, error: String(error) };
        }
    });

    // Execute arbitrary SQL query
    safeHandle('database:executeQuery', async (event, sql: string) => {
        try {
            // Safety check: only allow SELECT queries for now
            const trimmedSQL = sql.trim().toLowerCase();
            if (!trimmedSQL.startsWith('select')) {
                return {
                    success: false,
                    error: 'Only SELECT queries are allowed for safety. Use the database protocol server for write operations.'
                };
            }

            const result = await database.query(sql);

            return {
                success: true,
                rows: result.rows,
                rowCount: result.rows.length
            };
        } catch (error) {
            console.error('[DatabaseBrowserHandlers] Error executing query:', error);
            return { success: false, error: String(error) };
        }
    });

    // Get database stats
    safeHandle('database:getStats', async () => {
        try {
            const stats = await database.getStats();
            return { success: true, stats };
        } catch (error) {
            console.error('[DatabaseBrowserHandlers] Error fetching database stats:', error);
            return { success: false, error: String(error) };
        }
    });

    // Startup logging - uncomment if debugging handler registration
    // console.log('[DatabaseBrowserHandlers] Database browser handlers registered');
}
