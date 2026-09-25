'use strict';
(() => {
  const tr = (key, options) => globalThis.toolkitI18n.t(key, options);
  const button = document.getElementById('releaseUpdateButton');
  const source = document.getElementById('releaseSourceSelect');
  const dialog = document.getElementById('releaseSourceDialog');
  const api = window.electronAPI;
  if (!button || !api?.checkReleaseUpdate) return;
  const OFFICIAL = 'Schlossgespensty/AI-Toolkit';
  let build = null, busy = false, serial = 0, selected = OFFICIAL;
  function showSource(repo) {
    selected = repo;
    if (!source) return;
    if (![...source.options].some(option => option.value === repo)) {
      const option = document.createElement('option'); option.value = repo;
      option.textContent = repo.toLowerCase() === OFFICIAL.toLowerCase() ? tr("interface:official_releases") : `${tr('details:experimental_snapshot')}: ${repo.split('/')[0]}`;
      option.title = repo; source.add(option, source.querySelector('[value="other"]'));
    }
    source.value = repo; source.title = tr("updates:update_source_value", { repo: repo });
  }
  function renderUpdate() {
    if (!build) return;
    const available = build.status === 'available';
    button.classList.toggle('releaseAvailable', available);
    button.classList.toggle('releaseCurrent', build.status === 'current');
    button.textContent = available ? tr("updates:install_value", { latest: build.latest }) : build.status === 'current' ? tr("updates:up_to_date")
      : build.status === 'empty' ? tr("updates:no_published_builds") : build.status === 'unsupported' ? tr("updates:no_compatible_build") : tr("updates:retry_updates");
    button.title = available ? tr("updates:value_from_value_value_download_install_and_restart_installed_value", { value1: build.experimental ? tr('details:experimental_snapshot') : tr('details:official_release'), repo: build.repo, latest: build.latest, installed: build.installed })
      : build.status === 'current' ? tr("updates:installed_value_value_checked_on_startup_and_hourly", { repo: build.repo, latest: build.latest })
      : build.message || tr("updates:no_installable_windows_zip_with_a_checksum_found_in_value", { repo: build.repo });
  }
  async function check(force = false) {
    if (busy) return;
    const request = ++serial;
    button.disabled = true; button.textContent = tr("updates:checking_updates");
    try {
      const result = await api.checkReleaseUpdate(force);
      if (request !== serial) return;
      if (result.experimental && result.status === 'empty') {
        const old = result.repo;
        await choose(OFFICIAL);
        source?.querySelectorAll('option').forEach(option => { if (option.value === old) option.remove(); });
        return;
      }
      showSource(result.repo || selected); build = result;
      renderUpdate();
    } catch (error) {
      if (request !== serial) return;
      build = null; button.classList.remove('releaseAvailable', 'releaseCurrent');
      button.textContent = tr("updates:retry_updates"); button.title = error.message;
    } finally { if (request === serial) button.disabled = false; }
  }
  async function choose(repo) {
    ++serial; build = null; source.disabled = true; button.disabled = true;
    try { showSource(await api.setUpdateSource(repo)); await check(); }
    finally { source.disabled = false; button.disabled = false; }
  }
  source?.addEventListener('change', async () => {
    const repo = source.value; source.value = selected;
    if (repo === 'other') { dialog.showModal(); document.getElementById('releaseSourceRepo').focus(); return; }
    try { await choose(repo); } catch (error) { button.title = error.message; button.textContent = tr("updates:retry_updates"); }
  });
  document.getElementById('releaseSourceCancel')?.addEventListener('click', () => dialog.close());
  document.getElementById('releaseSourceForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; submit.disabled = true;
    try { await choose(document.getElementById('releaseSourceRepo').value.trim()); dialog.close(); }
    catch (error) { document.getElementById('releaseSourceError').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  api.onUpdateSourceChanged?.(repo => { showSource(repo); check(); });
  button.addEventListener('click', async () => {
    if (busy) return;
    if (build?.status !== 'available') return check(true);
    busy = true; ++serial; button.disabled = true; if (source) source.disabled = true;
    button.textContent = tr("updates:downloading_update");
    try {
      const release = await api.prepareReleaseUpdate(build.key);
      if (!await window.unsavedChanges.confirmAll(tr("updates:installing_the_selected_build_and_restarting_toolkit"))) {
        button.textContent = tr("updates:install_value_2", { version: release.version }); return;
      }
      button.textContent = tr("updates:restarting");
      await api.installReleaseUpdate();
    } catch (error) {
      build = null; button.classList.remove('releaseAvailable', 'releaseCurrent');
      button.textContent = tr("updates:retry_update");
      button.title = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
      window.appWorkspace?.setStatus(button.title);
    } finally { busy = false; button.disabled = false; if (source) source.disabled = false; }
  });
  async function initialize() {
    try {
      const {selected:repo, repos} = await api.listUpdateSources();
      if (source) source.replaceChildren();
      for (const entry of repos) showSource(entry);
      if (repos.includes(repo)) showSource(repo);
      else await choose(OFFICIAL);
    } catch { /* Official checks still work if fork discovery is unavailable. */ }
    if (source && !source.querySelector('[value="other"]')) { const option = document.createElement('option'); option.value = 'other'; option.textContent = tr("updates:other_fork"); source.add(option); source.value = selected; }
    check();
  }
  function hourly() { setTimeout(() => { if (!busy) initialize(); hourly(); }, 3600000 - Date.now() % 3600000 + 100); }
  window.toolkitI18n?.onChange(() => {
    for (const option of source?.options || []) option.textContent = option.value === 'other' ? tr('updates:other_fork') : option.value.toLowerCase() === OFFICIAL.toLowerCase() ? tr('interface:official_releases') : tr('details:experimental_snapshot') + ': ' + option.value.split('/')[0];
    if (!busy) renderUpdate();
  });
  initialize(); hourly();
})();
