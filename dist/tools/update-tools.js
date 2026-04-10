/**
 * Update Tools
 *
 * Exposes update checking and applying as agent tools.
 * The agent can call check_for_updates to see if an update is available,
 * and apply_update to pull + rebuild + restart autonomously.
 */
export function createUpdateTools(bus, checker, updater, pool) {
    return [
        {
            name: 'check_for_updates',
            description: 'Check whether a newer version of Sigil is available from the remote git repository. Returns update status and commit count.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
            approval: 'auto',
            async execute() {
                try {
                    const result = checker.check();
                    if (!result.hasUpdate) {
                        return 'Sigil is up to date.';
                    }
                    return (`Update available: ${result.commitCount} commit(s) behind. ` +
                        `Current: ${result.currentSha.slice(0, 7)}, Latest: ${result.latestSha.slice(0, 7)}.`);
                }
                catch (err) {
                    return `Update check failed: ${err.message}`;
                }
            },
        },
        {
            name: 'apply_update',
            description: 'Apply the latest update from the remote git repository. Pulls changes, rebuilds, reviews local overrides, and restarts Sigil. The process will restart — the current session will end.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
            approval: 'auto',
            async execute() {
                try {
                    // apply() restarts the process — this return is never reached if successful
                    await updater.apply(bus, pool);
                    return 'Update applied. Sigil is restarting...';
                }
                catch (err) {
                    return `Update failed: ${err.message}`;
                }
            },
        },
    ];
}
//# sourceMappingURL=update-tools.js.map