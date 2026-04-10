/**
 * Override Reviewer
 *
 * After a git pull, scans local/ for agent-created overrides and compares
 * each one against the updated src/ file using a cheap LLM call.
 *
 * Decisions:
 *   (a) still valid  → keep, no event
 *   (b) stale        → delete override, emit update:override_removed
 *   (c) unclear      → keep, emit update:override_flagged
 *
 * If no src/ match exists (file was deleted/moved), the override is removed
 * automatically without an LLM call.
 */
import { readdirSync, statSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
const REVIEW_PROMPT = `The local override was written to patch the original source file. Given the updated source below, is this override:
(a) still valid - the patch is still needed and compatible
(b) stale - the source has changed enough that the override is superseded or incompatible
(c) unclear - you cannot determine without more context

Reply with just the letter: a, b, or c. Then one sentence of reasoning.

Updated source:
{source}

Local override:
{override}`;
export class OverrideReviewer {
    cwd;
    localDir;
    srcDir;
    constructor(cwd) {
        this.cwd = cwd;
        this.localDir = join(cwd, 'local');
        this.srcDir = join(cwd, 'src');
    }
    async review(bus, pool) {
        const files = this.scanLocal();
        if (files.length === 0)
            return;
        const cheapest = pool ? pool.getCheapest() : null;
        for (const localPath of files) {
            const relPath = relative(this.localDir, localPath);
            const srcPath = this.findSrcFile(relPath);
            if (!srcPath) {
                // Source was deleted or moved — remove override unconditionally
                try {
                    unlinkSync(localPath);
                    bus.emit('update:override_removed', {
                        path: relPath,
                        reason: 'Source file no longer exists',
                    });
                    console.log(`[Updater] Override removed (no source): ${relPath}`);
                }
                catch (err) {
                    console.warn(`[Updater] Failed to remove override ${relPath}:`, err.message);
                }
                continue;
            }
            if (!cheapest) {
                // No model available — flag for manual review
                bus.emit('update:override_flagged', {
                    path: relPath,
                    reason: 'No model available for automated review',
                });
                console.warn(`[Updater] Override flagged (no model): ${relPath}`);
                continue;
            }
            try {
                const srcContent = readFileSync(srcPath, 'utf-8').slice(0, 3000);
                const overrideContent = readFileSync(localPath, 'utf-8').slice(0, 3000);
                const prompt = REVIEW_PROMPT
                    .replace('{source}', srcContent)
                    .replace('{override}', overrideContent);
                const req = {
                    messages: [{ role: 'user', content: prompt }],
                    model: cheapest.model.model,
                    maxTokens: 100,
                    temperature: 0,
                };
                const response = await cheapest.provider.complete(req);
                const text = response.content.trim();
                const letter = text[0]?.toLowerCase();
                const reasoning = text.slice(1).replace(/^[.,:]\s*/, '').trim() || 'No reason given';
                if (letter === 'b') {
                    unlinkSync(localPath);
                    bus.emit('update:override_removed', { path: relPath, reason: reasoning });
                    console.log(`[Updater] Override removed (stale): ${relPath}`);
                }
                else if (letter === 'c') {
                    bus.emit('update:override_flagged', { path: relPath, reason: reasoning });
                    console.warn(`[Updater] Override flagged for review: ${relPath}`);
                }
                // letter === 'a': still valid, do nothing
            }
            catch (err) {
                const error = err.message;
                bus.emit('update:override_flagged', {
                    path: relPath,
                    reason: `Review failed: ${error}`,
                });
                console.warn(`[Updater] Override review failed for ${relPath}:`, error);
            }
        }
    }
    scanLocal() {
        if (!existsSync(this.localDir))
            return [];
        return this.scanDir(this.localDir);
    }
    scanDir(dir) {
        const results = [];
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                results.push(...this.scanDir(full));
            }
            else {
                results.push(full);
            }
        }
        return results;
    }
    /**
     * Find the src/ counterpart to a local/ file path.
     * Tries both .ts and .js extensions since local/ overrides may use .js
     * while src/ uses .ts.
     */
    findSrcFile(relPath) {
        const candidates = [
            join(this.srcDir, relPath),
            join(this.srcDir, relPath.replace(/\.js$/, '.ts')),
            join(this.srcDir, relPath.replace(/\.ts$/, '.js')),
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate))
                return candidate;
        }
        return null;
    }
}
//# sourceMappingURL=override-reviewer.js.map