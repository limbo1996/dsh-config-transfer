window.__ModuleLoader__.load({
  id: 'dshsync',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const EN = {
      sectionLabel: 'Config Sync',
      pageTitle: 'Config Sync',
      pageDescription:
        'Move this computer’s DSH Desktop configuration to another computer. The file contains installed plugins, plugin settings, inserted plugin entries, and user skills. Credentials and API keys are never exported.',
      exportTitle: 'Save configuration',
      exportDescription:
        'Download one JSON file with this computer’s configuration. Do this on the old computer first.',
      exportButton: 'Save to file',
      exporting: 'Reading configuration…',
      exportDone: 'Configuration file downloaded.',
      exportStatThirdParty: 'Third-party plugins',
      exportStatBuiltin: 'DSH built-in',
      exportStatConfigs: 'Config entries',
      exportStatInserts: 'Inserted rows',
      exportStatSkills: 'Skills',
      exportStatRedactions: 'Redacted',
      importTitle: 'Import configuration',
      importDescription:
        'Choose a file saved by Config Sync on the other computer. You will see what will change before anything is applied.',
      importButton: 'Choose file…',
      planTitle: 'Review import',
      planSource: 'From {profile} · {platform} · {date}',
      planBuiltinNote:
        'This configuration contains {count} DSH built-in bundles; they are not installed again, only their enablement is restored.',
      planSummary: 'This import will:',
      bundlesToInstall: 'Install plugins',
      bundlesToEnable: 'Enable plugins',
      bundlesToDisable: 'Disable plugins',
      rowsToChange: 'Change plugin rows',
      insertsToWrite: 'Write inserted entries',
      configsToApply: 'Apply configuration',
      settingsToApply: 'Apply settings',
      skillsToImport: 'Import skills',
      skillsSkipped: 'Skills already present',
      skillsSkippedNote:
        '{count} skills already exist on this machine and will not be overwritten.',
      pendingConfigs: 'Wait for restart',
      planPendingHint: 'Some settings need a restart before they can be applied: {count}',
      manualActions: 'Manual steps',
      conflictsTitle: 'Conflicts',
      warningsTitle: 'Warnings',
      confirmImport: 'Import now',
      cancel: 'Cancel',
      confirmHint:
        'Plugins are installed from the sources recorded in the file. Local/link packages cannot be installed automatically.',
      applyingTitle: 'Importing',
      applyingHint: 'Installing plugins can take several minutes. Keep this page open.',
      progress: 'Step {step} of {total}',
      importDone: 'Import finished',
      importIssues: 'Import finished with issues',
      importFailed: 'Import failed',
      reportInstalled: 'Installed',
      reportFailedInstalls: 'Install failures',
      reportToggles: 'Plugin toggles',
      reportConfigs: 'Configuration applied',
      reportConfigFailures: 'Configuration failures',
      reportSettings: 'Settings applied',
      reportSettingsFailures: 'Settings failures',
      reportSkills: 'Skills written',
      reportSkillsSkipped: 'Skills skipped',
      reportPending: 'Waiting for restart',
      reportRestart: 'Restart required',
      restartHint:
        'Restart DSH Desktop to finish loading host plugins. Configuration that could not be applied yet is saved and will be applied automatically after restart.',
      reportManual: 'Manual steps',
      reportConflicts: 'Conflicts',
      reportWarnings: 'Warnings',
      anotherFile: 'Import another file',
      details: 'Details',
      fileTooLarge: 'The file is larger than 32 MiB.',
      invalidJson: 'The selected file is not valid JSON.',
      networkError: 'Cannot reach the Config Sync service. Make sure the plugin is enabled and reload the page.',
      busy: 'Working…',
      close: 'Close',
      pendingTitle: 'Remaining after restart',
      pendingEmpty: 'Nothing is waiting.',
      notAvailable: 'Config Sync is unavailable in this Harness composition.',
    }

    const ZH = {
      sectionLabel: '配置同步',
      pageTitle: '配置同步',
      pageDescription:
        '把本机的 DSH Desktop 配置迁移到另一台电脑。文件包含已安装插件、插件设置、插入的插件条目和用户技能。凭据与 API 密钥不会被导出。',
      exportTitle: '保存配置',
      exportDescription: '下载一个包含本机配置的 JSON 文件。请在旧电脑上先执行这一步。',
      exportButton: '保存到文件',
      exporting: '正在读取配置…',
      exportDone: '配置文件已下载。',
      exportStatThirdParty: '第三方插件',
      exportStatBuiltin: 'DSH 自带',
      exportStatConfigs: '配置项',
      exportStatInserts: '插入条目',
      exportStatSkills: '技能',
      exportStatRedactions: '已脱敏',
      importTitle: '导入配置',
      importDescription:
        '选择另一台电脑上用配置同步保存的文件。应用前会先显示将要发生的变更。',
      importButton: '选择文件…',
      planTitle: '确认导入',
      planSource: '来自 {profile} · {platform} · {date}',
      planBuiltinNote:
        '这份配置里有 {count} 个 DSH 自带 bundle；导入不会重复安装，只恢复其启用状态。',
      planSummary: '本次导入将：',
      bundlesToInstall: '安装插件',
      bundlesToEnable: '启用插件',
      bundlesToDisable: '停用插件',
      rowsToChange: '切换插件条目',
      insertsToWrite: '写入插入条目',
      configsToApply: '应用配置',
      settingsToApply: '应用设置',
      skillsToImport: '导入技能',
      skillsSkipped: '已存在的技能',
      skillsSkippedNote: '本机已有 {count} 个技能，导入不会覆盖。',
      pendingConfigs: '等待重启',
      planPendingHint: '部分设置需要等重启后才能应用：{count} 项',
      manualActions: '手动步骤',
      conflictsTitle: '冲突',
      warningsTitle: '警告',
      confirmImport: '开始导入',
      cancel: '取消',
      confirmHint:
        '插件将从文件中记录的来源安装。本地/链接包无法自动安装。',
      applyingTitle: '正在导入',
      applyingHint: '安装插件可能需要几分钟，请保持此页面打开。',
      progress: '第 {step} / {total} 步',
      importDone: '导入完成',
      importIssues: '导入完成，但有需要处理的问题',
      importFailed: '导入失败',
      reportInstalled: '已安装',
      reportFailedInstalls: '安装失败',
      reportToggles: '插件切换',
      reportConfigs: '已应用配置',
      reportConfigFailures: '配置失败',
      reportSettings: '已应用设置',
      reportSettingsFailures: '设置失败',
      reportSkills: '已写入技能',
      reportSkillsSkipped: '已跳过的技能',
      reportPending: '等待重启',
      reportRestart: '需要重启',
      restartHint:
        '请重启 DSH Desktop 以完成 Host 插件加载。暂时无法应用的配置已保存，重启后会自动应用。',
      reportManual: '手动步骤',
      reportConflicts: '冲突',
      reportWarnings: '警告',
      anotherFile: '导入另一个文件',
      details: '详情',
      fileTooLarge: '文件大于 32 MiB。',
      invalidJson: '所选文件不是有效的 JSON。',
      networkError: '无法连接配置同步服务。请确认插件已启用并刷新页面。',
      busy: '处理中…',
      close: '关闭',
      pendingTitle: '重启后剩余',
      pendingEmpty: '没有剩余项。',
      notAvailable: '当前 Harness 组合不支持配置同步。',
    }

    const CSS = `
      .dshsync-page { max-width: 780px; padding: 2px 0 48px; color: var(--dsw-alias-label-primary); }
      .dshsync-title { margin: 0 0 6px; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
      .dshsync-subtitle { margin: 0 0 20px; font-size: 13px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
      .dshsync-card { margin: 0 0 14px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
      .dshsync-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .dshsync-card-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
      .dshsync-card-text { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dshsync-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; }
      .dshsync-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap; }
      .dshsync-button:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
      .dshsync-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .dshsync-button:disabled { opacity: 0.5; cursor: not-allowed; }
      .dshsync-button-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); }
      .dshsync-button-primary:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .dshsync-button-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
      .dshsync-file { display: none; }
      .dshsync-note { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dshsync-error { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
      .dshsync-success { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-success-primary); }
      .dshsync-warn { margin: 10px 0 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-state-warn-primary); }
      .dshsync-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 8px; margin-top: 14px; }
      .dshsync-stat { padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
      .dshsync-stat-value { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
      .dshsync-stat-label { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .dshsync-details { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; line-height: 1.6; }
      .dshsync-details > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
      .dshsync-list { margin: 8px 0 0; padding: 0; list-style: none; }
      .dshsync-list li { padding: 3px 0; overflow-wrap: anywhere; }
      .dshsync-list code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .dshsync-progress { height: 6px; margin-top: 14px; overflow: hidden; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); }
      .dshsync-progress-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary); transition: width 0.25s ease; }
      .dshsync-status { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
      .dshsync-spinner { width: 14px; height: 14px; flex: none; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: dshsync-spin 0.8s linear infinite; }
      @keyframes dshsync-spin { to { transform: rotate(360deg); } }
      .dshsync-banner { margin-top: 12px; padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.6; }
      .dshsync-banner-warn { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-label-primary); }
      .dshsync-banner-error { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary); }
      .dshsync-banner-success { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-state-success-primary); color: var(--dsw-alias-label-primary); }
      .dshsync-muted { color: var(--dsw-alias-label-secondary); }
      .dshsync-inline { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 10px; font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
    `

    const PAGE_SIZE_LIMIT = 32 * 1024 * 1024

    async function requestJson(path, init) {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...init,
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      if (!response.ok) {
        const message = data && typeof data.message === 'string' ? data.message : `HTTP ${response.status}`
        throw new Error(message)
      }
      if (data && data.ok === false) {
        throw new Error(typeof data.message === 'string' ? data.message : 'Request failed')
      }
      return data
    }

    function downloadJson(filename, text) {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.rel = 'noopener'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }

    function timestampName() {
      const now = new Date()
      const pad = (value) => String(value).padStart(2, '0')
      return `dshsync-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value.length === 0) return '—'
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      return date.toLocaleString()
    }

    function Stat(props) {
      return h(
        'div',
        { className: 'dshsync-stat' },
        h('div', { className: 'dshsync-stat-value' }, String(props.value)),
        h('div', { className: 'dshsync-stat-label' }, props.label),
      )
    }

    function StatGrid(props) {
      const entries = props.items.filter((item) => item !== undefined && item !== null)
      if (entries.length === 0) return null
      return h(
        'div',
        { className: 'dshsync-stats' },
        entries.map((item, index) =>
          h(Stat, { key: `${item.label}-${index}`, value: item.value, label: item.label }),
        ),
      )
    }

    function DetailList(props) {
      const items = Array.isArray(props.items) ? props.items : []
      if (items.length === 0) return null
      return h(
        'details',
        { className: 'dshsync-details', open: props.open === true },
        h('summary', null, `${props.title} (${items.length})`),
        h(
          'ul',
          { className: 'dshsync-list' },
          items.map((item, index) =>
            h(
              'li',
              { key: `${props.title}-${index}` },
              typeof item === 'string'
                ? item
                : h(
                    React.Fragment,
                    null,
                    item.name !== undefined && item.name !== null
                      ? h('strong', null, String(item.name))
                      : null,
                    item.name !== undefined && item.name !== null && item.detail !== undefined
                      ? ' — '
                      : null,
                    item.detail !== undefined ? String(item.detail) : null,
                    item.spec !== undefined
                      ? h('code', null, ` ${String(item.spec)}`)
                      : null,
                  ),
            ),
          ),
        ),
      )
    }

    function PlanView(props) {
      const { plan, t } = props
      const summary = plan.summary || {}
      const pendingTotal =
        (summary.pendingConfigs || 0) + (summary.pendingSettings || 0) + (summary.pendingRows || 0)
      return h(
        'div',
        { className: 'dshsync-card' },
        h('div', { className: 'dshsync-card-title' }, t('planTitle')),
        h(
          'div',
          { className: 'dshsync-card-text' },
          t('planSummary'),
        ),
        h(StatGrid, {
          items: [
            { label: t('bundlesToInstall'), value: summary.bundlesToInstall || 0 },
            { label: t('bundlesToEnable'), value: summary.bundlesToEnable || 0 },
            { label: t('bundlesToDisable'), value: summary.bundlesToDisable || 0 },
            { label: t('rowsToChange'), value: summary.rowsToChange || 0 },
            { label: t('insertsToWrite'), value: summary.inserts || 0 },
            { label: t('configsToApply'), value: summary.configs || 0 },
            { label: t('settingsToApply'), value: summary.settings || 0 },
            { label: t('skillsToImport'), value: summary.skills || 0 },
            { label: t('pendingConfigs'), value: pendingTotal },
          ],
        }),
        pendingTotal > 0
          ? h('p', { className: 'dshsync-note' }, t('planPendingHint', { count: pendingTotal }))
          : null,
        (summary.builtinBundles || 0) > 0
          ? h('p', { className: 'dshsync-note' }, t('planBuiltinNote', { count: summary.builtinBundles }))
          : null,
        (summary.skillsSkipped || 0) > 0
          ? h('p', { className: 'dshsync-note' }, t('skillsSkippedNote', { count: summary.skillsSkipped }))
          : null,
        plan.source && (plan.source.profile || plan.source.platform)
          ? h(
              'div',
              { className: 'dshsync-inline' },
              t('planSource', {
                profile: plan.source.profile || '—',
                platform: plan.source.platform || '—',
                date: formatDate(plan.source.exportedAt),
              }),
            )
          : null,
        h(DetailList, {
          title: t('bundlesToInstall'),
          items: (plan.installs || []).map((item) => ({
            name: item.name,
            detail: item.version ? `@${item.version}` : undefined,
            spec: item.spec,
          })),
          open: true,
        }),
        h(DetailList, {
          title: t('exportStatBuiltin'),
          items: (plan.builtinBundles || []).map((name) => ({ name })),
        }),
        h(DetailList, {
          title: t('configsToApply'),
          items: (plan.configs || []).map((item) => ({ name: item.name || item.id })),
        }),
        h(DetailList, {
          title: t('insertsToWrite'),
          items: (plan.inserts || []).map((item) => ({ name: item.id, detail: item.name })),
        }),
        h(DetailList, {
          title: t('skillsToImport'),
          items: (plan.skills || []).map((item) => ({
            name: item.name,
            detail: `${item.root} · ${item.kind} · ${item.fileCount}`,
          })),
        }),
        h(DetailList, {
          title: t('skillsSkipped'),
          items: (plan.skipped || []).map((item) => ({
            name: item.id,
            detail: item.detail,
          })),
        }),
        h(DetailList, {
          title: t('manualActions'),
          items: plan.manual || [],
          open: (plan.manual || []).length > 0,
        }),
        h(DetailList, { title: t('conflictsTitle'), items: plan.conflicts || [], open: true }),
        h(DetailList, { title: t('warningsTitle'), items: plan.warnings || [] }),
        h(
          'div',
          { className: 'dshsync-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshsync-button dshsync-button-primary',
              onClick: props.onConfirm,
              disabled: props.busy,
            },
            t('confirmImport'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dshsync-button',
              onClick: props.onCancel,
              disabled: props.busy,
            },
            t('cancel'),
          ),
        ),
        h('p', { className: 'dshsync-note' }, t('confirmHint')),
      )
    }

    function ProgressView(props) {
      const { state, t } = props
      const total = Number(state.total) || 0
      const step = Number(state.step) || 0
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((step / total) * 100))) : 0
      const done = state.phase === 'done'
      const failed = state.phase === 'error'
      return h(
        'div',
        { className: 'dshsync-card' },
        h(
          'div',
          { className: 'dshsync-card-head' },
          h('div', null, h('div', { className: 'dshsync-card-title' }, done ? t('importDone') : failed ? t('importFailed') : t('applyingTitle'))),
        ),
        h(
          'div',
          { className: 'dshsync-status' },
          !done && !failed ? h('span', { className: 'dshsync-spinner', 'aria-hidden': true }) : null,
          h('span', null, state.message || (done ? t('importDone') : t('busy'))),
          total > 0 && !done && !failed ? h('span', { className: 'dshsync-muted' }, t('progress', { step, total })) : null,
        ),
        !done && !failed
          ? h(
              'div',
              { className: 'dshsync-progress', role: 'progressbar', 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 },
              h('div', { className: 'dshsync-progress-fill', style: { width: `${percent}%` } }),
            )
          : null,
        !done && !failed ? h('p', { className: 'dshsync-note' }, t('applyingHint')) : null,
        failed && state.error ? h('p', { className: 'dshsync-error' }, state.error) : null,
      )
    }

    function ReportView(props) {
      const { report, t } = props
      const counts = report.pending || {}
      const pendingTotal = Number(counts.total) || 0
      const hasIssues =
        (report.failedInstalls || []).length > 0 || (report.conflicts || []).length > 0
      let banner
      if (report.restartRequired) {
        banner = h(
          'div',
          { className: 'dshsync-banner dshsync-banner-warn' },
          h('strong', null, t('reportRestart')),
          h('div', null, t('restartHint')),
        )
      } else if (hasIssues) {
        banner = h('div', { className: 'dshsync-banner dshsync-banner-error' }, t('importIssues'))
      } else {
        banner = h('div', { className: 'dshsync-banner dshsync-banner-success' }, t('importDone'))
      }
      return h(
        'div',
        { className: 'dshsync-card' },
        h('div', { className: 'dshsync-card-title' }, t('importDone')),
        h(StatGrid, {
          items: [
            { label: t('reportInstalled'), value: (report.installed || []).length },
            { label: t('reportFailedInstalls'), value: (report.failedInstalls || []).length },
            {
              label: t('reportToggles'),
              value: (report.bundleChanges || []).length + (report.rowChanges || []).length,
            },
            { label: t('reportConfigs'), value: (report.configsApplied || []).length },
            { label: t('reportSettings'), value: (report.settingsApplied || []).length },
            { label: t('reportSkills'), value: (report.skills?.written || []).length },
            { label: t('reportPending'), value: pendingTotal },
          ],
        }),
        banner,
        h(DetailList, {
          title: t('reportInstalled'),
          items: (report.installed || []).map((item) => ({
            name: item.name,
            detail: item.application === 'applied' ? undefined : item.application,
            spec: item.version ? `@${item.version}` : undefined,
          })),
        }),
        h(DetailList, {
          title: t('reportFailedInstalls'),
          items: (report.failedInstalls || []).map((item) => ({
            name: item.name,
            detail: item.diagnostic || item.error,
          })),
          open: (report.failedInstalls || []).length > 0,
        }),
        h(DetailList, {
          title: t('reportConfigs'),
          items: (report.configsApplied || []).map((item) => ({ name: item.name || item.id })),
        }),
        h(DetailList, {
          title: t('reportConfigFailures'),
          items: (report.configsFailed || []).map((item) => ({
            name: item.name || item.id,
            detail: item.error,
          })),
          open: (report.configsFailed || []).length > 0,
        }),
        h(DetailList, {
          title: t('reportSettings'),
          items: (report.settingsApplied || []).map((item) => ({ name: item.ns })),
        }),
        h(DetailList, {
          title: t('reportSettingsFailures'),
          items: (report.settingsFailed || []).map((item) => ({
            name: item.ns,
            detail: item.error,
          })),
          open: (report.settingsFailed || []).length > 0,
        }),
        h(DetailList, {
          title: t('reportSkills'),
          items: (report.skills?.written || []).map((item) => ({ name: item.name, detail: item.root })),
        }),
        h(DetailList, {
          title: t('reportSkillsSkipped'),
          items: (report.skills?.skipped || []).map((item) => ({ name: item.name, detail: item.reason })),
        }),
        h(DetailList, {
          title: t('reportManual'),
          items: report.manual || [],
          open: (report.manual || []).length > 0,
        }),
        h(DetailList, { title: t('reportConflicts'), items: report.conflicts || [], open: (report.conflicts || []).length > 0 }),
        h(DetailList, { title: t('reportWarnings'), items: report.warnings || [] }),
        h(
          'div',
          { className: 'dshsync-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dshsync-button dshsync-button-primary',
              onClick: props.onReset,
            },
            t('anotherFile'),
          ),
        ),
      )
    }

    function ConfigSyncPage(props) {
      const { t } = props
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [exportStats, setExportStats] = React.useState(null)
      const [file, setFile] = React.useState(null)
      const [plan, setPlan] = React.useState(null)
      const [state, setState] = React.useState(null)
      const [report, setReport] = React.useState(null)
      const fileRef = React.useRef(null)
      const pollRef = React.useRef(null)
      const pollFailures = React.useRef(0)
      const pollInFlight = React.useRef(false)

      function stopPolling() {
        if (pollRef.current !== null) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }

      function applyState(next) {
        setState(next)
        if (next && next.report) setReport(next.report)
      }

      function startPolling() {
        stopPolling()
        pollFailures.current = 0
        pollInFlight.current = false
        setBusy('applying')
        pollRef.current = setInterval(async () => {
          if (pollInFlight.current) return
          pollInFlight.current = true
          try {
            const data = await requestJson('/api/dshsync/state')
            pollFailures.current = 0
            applyState(data?.state)
            if (data?.state?.phase === 'done' || data?.state?.phase === 'error') {
              stopPolling()
              setBusy(null)
            }
          } catch (pollError) {
            pollFailures.current += 1
            if (pollFailures.current >= 12) {
              stopPolling()
              setBusy(null)
              setError(t('networkError'))
            }
          } finally {
            pollInFlight.current = false
          }
        }, 1000)
      }

      React.useEffect(() => {
        let mounted = true
        requestJson('/api/dshsync/state')
          .then((data) => {
            if (!mounted) return
            applyState(data?.state)
            if (data?.state?.phase === 'running') startPolling()
          })
          .catch(() => undefined)
        return () => {
          mounted = false
          stopPolling()
        }
      }, [])

      async function onExport() {
        setBusy('export')
        setError(null)
        setExportStats(null)
        try {
          const data = await requestJson('/api/dshsync/export')
          downloadJson(timestampName(), JSON.stringify(data.snapshot, null, 2))
          setExportStats(data.stats)
        } catch (exportError) {
          setError(String(exportError?.message ?? exportError))
        } finally {
          setBusy(null)
        }
      }

      async function planFile(chosen) {
        if (chosen.size > PAGE_SIZE_LIMIT) {
          setError(t('fileTooLarge'))
          return
        }
        setBusy('planning')
        setError(null)
        setPlan(null)
        setReport(null)
        try {
          const text = (await chosen.text()).replace(/^\uFEFF/u, '')
          try {
            JSON.parse(text)
          } catch {
            setError(t('invalidJson'))
            return
          }
          const data = await requestJson('/api/dshsync/plan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: text,
          })
          setFile({ name: chosen.name, text })
          setPlan(data.plan)
        } catch (planError) {
          setError(String(planError?.message ?? planError))
        } finally {
          setBusy(null)
        }
      }

      function onFileChosen(event) {
        const chosen = event.target.files && event.target.files[0]
        event.target.value = ''
        if (chosen) void planFile(chosen)
      }

      async function onConfirm() {
        if (file === null) return
        setBusy('applying')
        setError(null)
        try {
          await requestJson('/api/dshsync/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: file.text,
          })
          setPlan(null)
          applyState({ phase: 'running', step: 0, total: 0, message: t('busy') })
          startPolling()
        } catch (applyError) {
          setBusy(null)
          setError(String(applyError?.message ?? applyError))
        }
      }

      function reset() {
        setFile(null)
        setPlan(null)
        setReport(null)
        setState(null)
        setError(null)
        setExportStats(null)
      }

      const running = busy === 'applying' || state?.phase === 'running'

      return h(
        'div',
        { className: 'dshsync-page' },
        h('style', null, CSS),
        h('h2', { className: 'dshsync-title' }, t('pageTitle')),
        h('p', { className: 'dshsync-subtitle' }, t('pageDescription')),
        error !== null ? h('div', { className: 'dshsync-banner dshsync-banner-error' }, error) : null,
        h(
          'div',
          { className: 'dshsync-card' },
          h('div', { className: 'dshsync-card-title' }, t('exportTitle')),
          h('p', { className: 'dshsync-card-text' }, t('exportDescription')),
          h(
            'div',
            { className: 'dshsync-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshsync-button dshsync-button-primary',
                onClick: () => void onExport(),
                disabled: busy !== null || running,
              },
              busy === 'export' ? t('exporting') : t('exportButton'),
            ),
            exportStats
              ? h('span', { className: 'dshsync-success' }, t('exportDone'))
              : null,
          ),
          exportStats
            ? h(StatGrid, {
                items: [
                  {
                    label: t('exportStatThirdParty'),
                    value: exportStats.thirdPartyBundles ?? exportStats.bundles ?? 0,
                  },
                  { label: t('exportStatBuiltin'), value: exportStats.builtinBundles ?? 0 },
                  { label: t('exportStatConfigs'), value: exportStats.configs || 0 },
                  { label: t('exportStatInserts'), value: exportStats.inserts || 0 },
                  { label: t('exportStatSkills'), value: exportStats.skills || 0 },
                  { label: t('exportStatRedactions'), value: exportStats.redactions || 0 },
                ],
              })
            : null,
        ),
        h(
          'div',
          { className: 'dshsync-card' },
          h('div', { className: 'dshsync-card-title' }, t('importTitle')),
          h('p', { className: 'dshsync-card-text' }, t('importDescription')),
          h('input', {
            ref: fileRef,
            className: 'dshsync-file',
            type: 'file',
            accept: '.json,application/json',
            onChange: onFileChosen,
            'aria-hidden': true,
            tabIndex: -1,
          }),
          h(
            'div',
            { className: 'dshsync-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dshsync-button',
                onClick: () => fileRef.current && fileRef.current.click(),
                disabled: busy !== null || running,
              },
              busy === 'planning' ? t('busy') : t('importButton'),
            ),
            file ? h('span', { className: 'dshsync-muted' }, file.name) : null,
          ),
        ),
        plan !== null ? h(PlanView, { plan, t, busy: running, onConfirm, onCancel: reset }) : null,
        state !== null && (state.phase === 'running' || state.phase === 'error')
          ? h(ProgressView, { state, t })
          : null,
        report !== null ? h(ReportView, { report, t, onReset: reset }) : null,
        state && state.pending && state.pending.total > 0
          ? h(
              'div',
              { className: 'dshsync-card' },
              h('div', { className: 'dshsync-card-title' }, t('pendingTitle')),
              h(StatGrid, {
                items: [
                  { label: t('insertsToWrite'), value: state.pending.inserts },
                  { label: t('configsToApply'), value: state.pending.configs },
                  { label: t('settingsToApply'), value: state.pending.settings },
                  { label: t('rowsToChange'), value: state.pending.rows },
                ],
              }),
              h('p', { className: 'dshsync-note' }, t('restartHint')),
            )
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () => ctx.locale.register('dshsync', 'en', EN),
          'dshsync: English dictionary',
        )
        ctx.effect(
          () => ctx.locale.register('dshsync', 'zh', ZH),
          'dshsync: Chinese dictionary',
        )
        const translate = ctx.locale.bind('dshsync')
        ctx.effect(
          () =>
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'dshsync',
                  order: 35,
                  label: () => translate('sectionLabel'),
                  locale: 'dshsync',
                },
                ConfigSyncPage,
              ),
            ),
          'dshsync: settings section',
        )
      },
    }
  },
})
