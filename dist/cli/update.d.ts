/**
 * Update CLI Handler
 *
 * Handles `node dist/index.js update` and `node dist/index.js update --check`.
 *
 * update --check  → fetch + compare, print status, exit
 * update          → fetch + compare, apply if available, restart
 */
export declare function runUpdateCli(checkOnly: boolean): Promise<void>;
//# sourceMappingURL=update.d.ts.map