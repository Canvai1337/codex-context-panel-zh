import fs from 'node:fs/promises';
import path from 'node:path';

const positiveInt = value => Number.isSafeInteger(value) && value > 0;

// Reconstruct the ordinary full-context limit from Codex's model metadata
// and effective project config. Require agreement with the recorded window.
export function compactionGuide(report, model, config) {
  const scope = config?.model_auto_compact_token_limit_scope;
  const asyncCompaction = config?.features?.async_compaction;
  if (!model || !config || !positiveInt(report.window) || config.model_catalog_json ||
      (scope != null && scope !== 'total') || (asyncCompaction && asyncCompaction.enabled !== false)) return null;

  const raw = config.model_context_window ?? model.context_window ?? model.max_context_window;
  if (!positiveInt(raw)) return null;
  const max = model.max_context_window;
  const context = config.model_context_window != null && positiveInt(max) ? Math.min(raw, max) : raw;
  const usablePercent = model.effective_context_window_percent ?? 95;
  if (!positiveInt(usablePercent) || usablePercent > 100 ||
      Math.floor(context * usablePercent / 100) !== report.window) return null;

  const configured = config.model_auto_compact_token_limit ?? model.auto_compact_token_limit;
  if (configured != null && !positiveInt(configured)) return null;
  const atTurnEnd = config.model_post_turn_compact_threshold_percent;
  if (atTurnEnd != null && (!Number.isInteger(atTurnEnd) || atTurnEnd < 0 || atTurnEnd > 100)) return null;
  const threshold = Math.min(report.window, Math.floor(context * 0.9), configured ?? Infinity,
    atTurnEnd ? Math.ceil(report.window * atTurnEnd / 100) : Infinity);
  if (!positiveInt(threshold)) return null;
  return {threshold, remaining: report.used == null ? null : Math.max(0, threshold - report.used)};
}

export class CompactionReader {
  constructor(home, readConfig) {
    this.catalogPath = path.join(home, 'models_cache.json');
    this.readConfig = readConfig;
    this.models = new Map();
    this.configs = new Map();
    this.catalogAt = 0;
  }

  refresh(report) {
    if (!report.model || !positiveInt(report.window) || !report.cwd) return;
    const now = Date.now();
    if (now >= this.catalogAt) {
      this.catalogAt = now + 60000;
      void this.refreshCatalog();
    }
    const cached = this.configs.get(report.cwd);
    if (cached?.pending || (cached && cached.refreshAt > now)) return;
    const entry = {pending:true, config:cached?.config};
    this.configs.delete(report.cwd);
    this.configs.set(report.cwd, entry);
    if (this.configs.size > 32) this.configs.delete(this.configs.keys().next().value);
    void this.readConfig(report.cwd).then(config => {
      entry.config = config;
      entry.refreshAt = Date.now() + (config ? 60000 : 10000);
    }).catch(() => {
      entry.config = null;
      entry.refreshAt = Date.now() + 10000;
    }).finally(() => {entry.pending = false;});
  }

  async refreshCatalog() {
    try {
      const raw = await fs.readFile(this.catalogPath, 'utf8');
      const {models} = JSON.parse(raw.replace(/^\uFEFF/, ''));
      this.models = new Map(models.map(model => [model.slug, model]));
    } catch {
      this.models.clear();
    }
  }

  decorate({cwd, ...report}) {
    const config = this.configs.get(cwd)?.config;
    return {...report, ...(config ? {compaction:compactionGuide(report, this.models.get(report.model), config)} : {})};
  }
}
