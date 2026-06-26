import {
	App,
	ItemView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	normalizePath,
} from "obsidian";
import simpleGit, { SimpleGit, StatusResult, LogResult } from "simple-git";

// ---------------------------------------------------------------------------
// Sidebar View
// ---------------------------------------------------------------------------

export const GIT_SIDEBAR_VIEW = "git-integration-sidebar";

export class GitSidebarView extends ItemView {
	plugin: GitIntegrationPlugin;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: GitIntegrationPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GIT_SIDEBAR_VIEW;
	}

	getDisplayText(): string {
		return "Git";
	}

	getIcon(): string {
		return "git-branch";
	}

	async onOpen() {
		await this.render();
		// Auto-refresh every 30 s while the view is open
		this.refreshTimer = setInterval(() => this.render(), 30_000);
	}

	onClose() {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
		return Promise.resolve();
	}

	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("git-sidebar");

		// ---- Header row ----
		const header = container.createDiv({ cls: "git-sidebar-header" });
		header.createEl("span", { text: "Git", cls: "git-sidebar-title" });
		const headerBtns = header.createDiv({ cls: "git-sidebar-header-btns" });
		const refreshBtn = headerBtns.createEl("button", { cls: "git-sidebar-icon-btn", attr: { "aria-label": "Refresh" } });
		refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
		refreshBtn.addEventListener("click", () => this.render());
		const closeBtn = headerBtns.createEl("button", { cls: "git-sidebar-icon-btn", attr: { "aria-label": "Close" } });
		closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
		closeBtn.addEventListener("click", () => this.leaf.detach());

		// ---- Load status + log ----
		let status: StatusResult | null = null;
		let log: LogResult | null = null;
		let repoError = false;

		try {
			[status, log] = await Promise.all([
				this.plugin.git.status(),
				this.plugin.git.log({ maxCount: 10 }),
			]);
		} catch {
			repoError = true;
		}

		if (repoError || !status) {
			container.createEl("p", {
				text: "No git repository found in this vault.",
				cls: "git-sidebar-empty",
			});
			return;
		}

		// ---- Branch + sync info ----
		const branchSection = container.createDiv({ cls: "git-sidebar-section" });
		const branchRow = branchSection.createDiv({ cls: "git-sidebar-branch-row" });
		branchRow.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>`;
		branchRow.createEl("span", { text: status.current ?? "unknown", cls: "git-sidebar-branch-name" });
		if (status.tracking) {
			branchRow.createEl("span", { text: `→ ${status.tracking}`, cls: "git-sidebar-tracking" });
		}

		// ahead / behind pills
		if (status.ahead > 0 || status.behind > 0) {
			const pills = branchSection.createDiv({ cls: "git-sidebar-pills" });
			if (status.ahead > 0) pills.createEl("span", { text: `↑ ${status.ahead} ahead`, cls: "git-pill git-pill-ahead" });
			if (status.behind > 0) pills.createEl("span", { text: `↓ ${status.behind} behind`, cls: "git-pill git-pill-behind" });
		}

		// ---- Quick action buttons ----
		const actions = container.createDiv({ cls: "git-sidebar-section git-sidebar-actions" });

		const makeBtn = (label: string, icon: string, cb: () => void) => {
			const btn = actions.createEl("button", { cls: "git-sidebar-action-btn" });
			btn.innerHTML = icon;
			btn.createEl("span", { text: label });
			btn.addEventListener("click", cb);
			return btn;
		};

		makeBtn("Pull", `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`, () => {
			this.plugin.gitPull().then(() => this.render());
		});
		makeBtn("Stage All", `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`, () => {
			this.plugin.gitStageAll().then(() => this.render());
		});
		makeBtn("Commit", `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>`, () => {
			this.plugin.gitCommitWithPrompt().then(() => this.render());
		});
		makeBtn("Push", `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`, () => {
			this.plugin.gitPush().then(() => this.render());
		});
		makeBtn("Review Diffs", `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.5 12.5a2 2 0 0 1-2 1.5h-7a2 2 0 0 1-2-1.5L5 6"/><path d="M10 11h4"/></svg>`, () => {
			this.plugin.gitShowChangesDiffPopup();
		});
		if (status.staged.length > 0) {
			makeBtn("Unstage All", `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`, () => {
				this.plugin.gitUnstageAll().then(() => this.render());
			});
		}

		// ---- Changed files ----
		const totalChanged =
			status.staged.length +
			status.modified.length +
			status.not_added.length +
			status.deleted.length +
			status.conflicted.length;

		const filesSection = container.createDiv({ cls: "git-sidebar-section" });
		const filesHeader = filesSection.createDiv({ cls: "git-sidebar-section-header" });
		filesHeader.createEl("span", { text: `Changes${totalChanged > 0 ? ` (${totalChanged})` : ""}` });

		if (totalChanged === 0) {
			filesSection.createEl("p", { text: "Working tree clean.", cls: "git-sidebar-empty" });
		} else {
			const fileGroups: { label: string; cls: string; files: string[] }[] = [
				{ label: "Staged", cls: "git-file-staged", files: status.staged },
				{ label: "Modified", cls: "git-file-modified", files: status.modified },
				{ label: "Untracked", cls: "git-file-untracked", files: status.not_added },
				{ label: "Deleted", cls: "git-file-deleted", files: status.deleted },
				{ label: "Conflicted", cls: "git-file-conflicted", files: status.conflicted },
			];

			for (const group of fileGroups) {
				if (group.files.length === 0) continue;
				const groupEl = filesSection.createDiv({ cls: "git-file-group" });
				groupEl.createEl("span", { text: group.label, cls: "git-file-group-label" });
				for (const f of group.files) {
					const row = groupEl.createDiv({ cls: `git-file-row ${group.cls}` });
					row.createEl("span", { text: f, cls: "git-file-name" });
				}
			}
		}

		// ---- Recent commits ----
		const logSection = container.createDiv({ cls: "git-sidebar-section" });
		logSection.createDiv({ cls: "git-sidebar-section-header" }).createEl("span", { text: "Recent Commits" });

		if (!log || log.all.length === 0) {
			logSection.createEl("p", { text: "No commits yet.", cls: "git-sidebar-empty" });
		} else {
			for (const commit of log.all) {
				const row = logSection.createDiv({ cls: "git-commit-row" });
				row.createEl("code", { text: commit.hash.substring(0, 7), cls: "git-commit-hash" });
				const info = row.createDiv({ cls: "git-commit-info" });
				info.createEl("span", { text: commit.message, cls: "git-commit-msg" });
				info.createEl("span", {
					text: `${commit.author_name} · ${commit.date.substring(0, 10)}`,
					cls: "git-commit-meta",
				});
			}
		}

		// ---- Styles (injected once) ----
		if (!document.getElementById("git-sidebar-styles")) {
			const style = document.createElement("style");
			style.id = "git-sidebar-styles";
			style.textContent = GIT_SIDEBAR_STYLES;
			document.head.appendChild(style);
		}
	}
}

const GIT_SIDEBAR_STYLES = `
.git-sidebar { padding: 0; font-size: 13px; display: flex; flex-direction: column; gap: 0; }
.git-sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 6px; border-bottom: 1px solid var(--background-modifier-border); }
.git-sidebar-title { font-weight: 600; font-size: 14px; letter-spacing: 0.02em; }
.git-sidebar-header-btns { display: flex; align-items: center; gap: 2px; }
.git-sidebar-icon-btn { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 2px 4px; border-radius: 4px; display: flex; align-items: center; }
.git-sidebar-icon-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
.git-sidebar-section { padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); }
.git-sidebar-section:last-child { border-bottom: none; }
.git-sidebar-section-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 6px; }
.git-sidebar-branch-row { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.git-sidebar-branch-name { color: var(--text-accent); }
.git-sidebar-tracking { color: var(--text-muted); font-size: 12px; }
.git-sidebar-pills { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
.git-pill { font-size: 11px; padding: 1px 7px; border-radius: 10px; font-weight: 500; }
.git-pill-ahead { background: var(--color-green); color: #fff; }
.git-pill-behind { background: var(--color-orange); color: #fff; }
.git-sidebar-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.git-sidebar-action-btn { display: flex; align-items: center; gap: 5px; padding: 5px 8px; border-radius: 5px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); cursor: pointer; font-size: 12px; color: var(--text-normal); transition: background 0.15s; }
.git-sidebar-action-btn:hover { background: var(--background-modifier-hover); }
.git-sidebar-empty { color: var(--text-muted); font-size: 12px; margin: 0; padding: 2px 0; }
.git-file-group { margin-bottom: 6px; }
.git-file-group-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); display: block; margin-bottom: 3px; }
.git-file-row { padding: 2px 4px; border-radius: 3px; display: flex; align-items: center; gap: 6px; }
.git-file-name { font-size: 12px; word-break: break-all; }
.git-file-staged .git-file-name { color: var(--color-green); }
.git-file-modified .git-file-name { color: var(--color-orange); }
.git-file-untracked .git-file-name { color: var(--text-muted); }
.git-file-deleted .git-file-name { color: var(--color-red); }
.git-file-conflicted .git-file-name { color: var(--color-purple); }
.git-commit-row { display: flex; align-items: flex-start; gap: 7px; padding: 4px 0; border-bottom: 1px solid var(--background-modifier-border-hover); }
.git-commit-row:last-child { border-bottom: none; }
.git-commit-hash { font-size: 11px; padding: 1px 5px; background: var(--background-secondary); border-radius: 3px; color: var(--text-muted); white-space: nowrap; margin-top: 1px; }
.git-commit-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.git-commit-msg { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.git-commit-meta { font-size: 11px; color: var(--text-muted); }
`;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface GitIntegrationSettings {
	autoCommitEnabled: boolean;
	autoCommitIntervalMinutes: number;
	autoPushAfterCommit: boolean;
	defaultCommitMessage: string;
	showStatusBar: boolean;
	dateFormat: string;
}

type GitChangeKind = "staged" | "modified" | "untracked" | "deleted" | "conflicted";

interface GitChangeEntry {
	path: string;
	kind: GitChangeKind;
}

const DEFAULT_SETTINGS: GitIntegrationSettings = {
	autoCommitEnabled: false,
	autoCommitIntervalMinutes: 30,
	autoPushAfterCommit: false,
	defaultCommitMessage: "vault backup: {{date}}",
	showStatusBar: true,
	dateFormat: "YYYY-MM-DD HH:mm:ss",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(format: string): string {
	const now = new Date();
	return format
		.replace("YYYY", String(now.getFullYear()))
		.replace("MM", String(now.getMonth() + 1).padStart(2, "0"))
		.replace("DD", String(now.getDate()).padStart(2, "0"))
		.replace("HH", String(now.getHours()).padStart(2, "0"))
		.replace("mm", String(now.getMinutes()).padStart(2, "0"))
		.replace("ss", String(now.getSeconds()).padStart(2, "0"));
}

// ---------------------------------------------------------------------------
// Commit Message Modal
// ---------------------------------------------------------------------------

class CommitModal extends Modal {
	private message: string;
	private onSubmit: (message: string) => void;

	constructor(app: App, defaultMessage: string, onSubmit: (message: string) => void) {
		super(app);
		this.message = defaultMessage;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Commit changes" });

		const inputEl = contentEl.createEl("textarea", {
			cls: "git-commit-message-input",
		});
		inputEl.value = this.message;
		inputEl.rows = 4;
		inputEl.style.width = "100%";
		inputEl.style.marginBottom = "12px";
		inputEl.style.resize = "vertical";
		inputEl.addEventListener("input", () => {
			this.message = inputEl.value;
		});

		const buttonRow = contentEl.createDiv({ cls: "git-modal-buttons" });
		buttonRow.style.display = "flex";
		buttonRow.style.justifyContent = "flex-end";
		buttonRow.style.gap = "8px";

		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const commitBtn = buttonRow.createEl("button", {
			text: "Commit",
			cls: "mod-cta",
		});
		commitBtn.addEventListener("click", () => {
			if (!this.message.trim()) {
				new Notice("Commit message cannot be empty.");
				return;
			}
			this.onSubmit(this.message.trim());
			this.close();
		});

		inputEl.focus();
		inputEl.select();
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Git Log Modal
// ---------------------------------------------------------------------------

class GitLogModal extends Modal {
	private log: LogResult;

	constructor(app: App, log: LogResult) {
		super(app);
		this.log = log;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Git History" });

		if (!this.log.all || this.log.all.length === 0) {
			contentEl.createEl("p", { text: "No commits found." });
			return;
		}

		const table = contentEl.createEl("table");
		table.style.width = "100%";
		table.style.borderCollapse = "collapse";

		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		["Hash", "Date", "Author", "Message"].forEach((h) => {
			const th = headerRow.createEl("th", { text: h });
			th.style.textAlign = "left";
			th.style.padding = "6px 8px";
			th.style.borderBottom = "1px solid var(--background-modifier-border)";
		});

		const tbody = table.createEl("tbody");
		this.log.all.slice(0, 50).forEach((commit) => {
			const row = tbody.createEl("tr");
			row.style.borderBottom = "1px solid var(--background-modifier-border)";

			[
				commit.hash.substring(0, 7),
				commit.date.substring(0, 10),
				commit.author_name,
				commit.message,
			].forEach((text) => {
				const td = row.createEl("td", { text });
				td.style.padding = "5px 8px";
				td.style.fontSize = "0.88em";
			});
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Git Status Modal
// ---------------------------------------------------------------------------

class GitStatusModal extends Modal {
	private status: StatusResult;

	constructor(app: App, status: StatusResult) {
		super(app);
		this.status = status;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Git Status" });

		const s = this.status;
		contentEl.createEl("p", {
			text: `Branch: ${s.current ?? "unknown"}${s.tracking ? ` → ${s.tracking}` : ""}`,
		});

		const sections: { label: string; files: string[] }[] = [
			{ label: "Staged", files: s.staged },
			{ label: "Modified (unstaged)", files: s.modified },
			{ label: "Not tracked", files: s.not_added },
			{ label: "Deleted", files: s.deleted },
			{ label: "Conflicted", files: s.conflicted },
		];

		let hasContent = false;
		for (const section of sections) {
			if (section.files.length > 0) {
				hasContent = true;
				contentEl.createEl("h4", { text: section.label });
				const ul = contentEl.createEl("ul");
				section.files.forEach((f) => ul.createEl("li", { text: f }));
			}
		}

		if (!hasContent) {
			contentEl.createEl("p", { text: "Working tree clean. Nothing to commit." });
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

// ---------------------------------------------------------------------------
// Git Changes + Diff Modal
// ---------------------------------------------------------------------------

class GitChangesDiffModal extends Modal {
	private plugin: GitIntegrationPlugin;
	private changes: GitChangeEntry[] = [];
	private selectedKey: string | null = null;
	private currentDiffText = "";
	private viewMode: "unified" | "split" = "unified";
	private listEl: HTMLElement;
	private diffEl: HTMLElement;
	private viewModeLabelEl: HTMLElement;

	constructor(app: App, plugin: GitIntegrationPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		this.modalEl.style.width = "88vw";
		this.modalEl.style.maxWidth = "1500px";
		this.modalEl.style.height = "82vh";
		this.modalEl.style.maxHeight = "90vh";
		contentEl.empty();
		contentEl.style.height = "100%";
		contentEl.style.display = "flex";
		contentEl.style.flexDirection = "column";
		contentEl.createEl("h2", { text: "Changes and Diff" });

		const layout = contentEl.createDiv();
		layout.style.display = "grid";
		layout.style.gridTemplateColumns = "minmax(280px, 30%) 1fr";
		layout.style.gap = "12px";
		layout.style.height = "100%";
		layout.style.minHeight = "420px";

		const left = layout.createDiv();
		left.style.border = "1px solid var(--background-modifier-border)";
		left.style.borderRadius = "8px";
		left.style.overflow = "hidden";
		left.style.display = "flex";
		left.style.flexDirection = "column";

		const leftHeader = left.createDiv();
		leftHeader.style.padding = "8px 10px";
		leftHeader.style.borderBottom = "1px solid var(--background-modifier-border)";
		leftHeader.style.fontSize = "12px";
		leftHeader.style.fontWeight = "600";
		leftHeader.style.textTransform = "uppercase";
		leftHeader.style.letterSpacing = "0.05em";
		leftHeader.style.color = "var(--text-muted)";
		leftHeader.setText("Changed Files");

		this.listEl = left.createDiv();
		this.listEl.style.overflowY = "auto";
		this.listEl.style.padding = "6px";

		const right = layout.createDiv();
		right.style.border = "1px solid var(--background-modifier-border)";
		right.style.borderRadius = "8px";
		right.style.overflow = "hidden";
		right.style.display = "flex";
		right.style.flexDirection = "column";

		const rightHeader = right.createDiv();
		rightHeader.style.padding = "8px 10px";
		rightHeader.style.borderBottom = "1px solid var(--background-modifier-border)";
		rightHeader.style.display = "flex";
		rightHeader.style.justifyContent = "space-between";
		rightHeader.style.alignItems = "center";

		const rightTitle = rightHeader.createDiv({ text: "Diff" });
		rightTitle.style.fontSize = "12px";
		rightTitle.style.fontWeight = "600";
		rightTitle.style.textTransform = "uppercase";
		rightTitle.style.letterSpacing = "0.05em";
		rightTitle.style.color = "var(--text-muted)";

		const modeRow = rightHeader.createDiv();
		modeRow.style.display = "flex";
		modeRow.style.alignItems = "center";
		modeRow.style.gap = "6px";

		this.viewModeLabelEl = modeRow.createDiv({ text: "UNIFIED" });
		this.viewModeLabelEl.style.fontSize = "10px";
		this.viewModeLabelEl.style.letterSpacing = "0.05em";
		this.viewModeLabelEl.style.color = "var(--text-muted)";

		const modeBtn = modeRow.createEl("button", { text: "Split View" });
		modeBtn.style.fontSize = "11px";
		modeBtn.style.padding = "2px 8px";
		modeBtn.style.border = "1px solid var(--background-modifier-border)";
		modeBtn.style.borderRadius = "999px";
		modeBtn.style.background = "var(--background-secondary)";
		modeBtn.style.cursor = "pointer";
		modeBtn.addEventListener("click", () => {
			this.viewMode = this.viewMode === "unified" ? "split" : "unified";
			this.viewModeLabelEl.setText(this.viewMode.toUpperCase());
			modeBtn.setText(this.viewMode === "unified" ? "Split View" : "Unified View");
			this.renderDiffText(this.currentDiffText || "No diff output for this file.");
		});

		this.diffEl = right.createDiv();
		this.diffEl.style.margin = "0";
		this.diffEl.style.padding = "10px";
		this.diffEl.style.overflow = "auto";
		this.diffEl.style.height = "100%";
		this.diffEl.style.fontSize = "12px";
		this.diffEl.style.lineHeight = "1.4";
		this.diffEl.style.whiteSpace = "pre";
		this.diffEl.style.fontFamily = "var(--font-monospace)";
		this.renderDiffText("Loading changes...");

		await this.loadChanges();
	}

	onClose() {
		this.contentEl.empty();
	}

	private async loadChanges() {
		try {
			this.changes = await this.plugin.getChangedFilesWithKinds();
			if (this.changes.length === 0) {
				this.listEl.empty();
				this.listEl.createEl("p", { text: "Working tree clean.", cls: "git-sidebar-empty" });
				this.renderDiffText("No changes to show.");
				return;
			}

			if (!this.selectedKey) {
				this.selectedKey = `${this.changes[0].kind}:${this.changes[0].path}`;
			}

			this.renderFileList();
			const selected = this.changes.find(
				(c) => `${c.kind}:${c.path}` === this.selectedKey
			) ?? this.changes[0];
			await this.showDiffFor(selected);
		} catch (e) {
			this.listEl.empty();
			this.renderDiffText("Failed to load git changes.");
			const msg = e instanceof Error ? e.message : String(e);
			new Notice(`Git diff popup failed: ${msg}`, 8000);
		}
	}

	private renderFileList() {
		this.listEl.empty();
		for (const change of this.changes) {
			const key = `${change.kind}:${change.path}`;
			const row = this.listEl.createDiv();
			row.style.padding = "6px 8px";
			row.style.borderRadius = "6px";
			row.style.cursor = "pointer";
			row.style.marginBottom = "4px";
			row.style.border = "1px solid var(--background-modifier-border)";
			if (this.selectedKey === key) {
				row.style.background = "var(--background-modifier-hover)";
			}

			const label = row.createDiv();
			label.style.display = "flex";
			label.style.justifyContent = "space-between";
			label.style.alignItems = "center";
			label.style.gap = "8px";

			const pathEl = label.createEl("span", { text: change.path });
			pathEl.style.fontSize = "12px";
			pathEl.style.wordBreak = "break-all";

			const kindEl = label.createEl("span", { text: change.kind });
			kindEl.style.fontSize = "11px";
			kindEl.style.color = "var(--text-muted)";
			kindEl.style.textTransform = "uppercase";
			kindEl.style.letterSpacing = "0.04em";

			row.addEventListener("click", async () => {
				this.selectedKey = key;
				this.renderFileList();
				await this.showDiffFor(change);
			});
		}
	}

	private async showDiffFor(change: GitChangeEntry) {
		this.renderDiffText(`Loading diff for ${change.path}...`);
		try {
			const diff = await this.plugin.getDiffForChange(change);
			this.currentDiffText = diff || "No diff output for this file.";
			this.renderDiffText(this.currentDiffText);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.renderDiffText(`Unable to load diff.\n${msg}`);
		}
	}

	private renderDiffText(text: string) {
		if (this.viewMode === "split") {
			this.renderSplitDiff(text);
			return;
		}

		this.diffEl.empty();
		for (const line of text.split("\n")) {
			const row = this.diffEl.createDiv({ text: line.length > 0 ? line : " " });
			row.style.padding = "0 4px";
			if (line.startsWith("+++ ") || line.startsWith("--- ")) {
				row.style.color = "var(--text-accent)";
				row.style.fontWeight = "600";
			} else if (line.startsWith("@@")) {
				row.style.color = "var(--color-cyan)";
			} else if (line.startsWith("+") && !line.startsWith("+++")) {
				row.style.color = "var(--color-green)";
				row.style.background = "rgba(34, 197, 94, 0.12)";
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				row.style.color = "var(--color-red)";
				row.style.background = "rgba(239, 68, 68, 0.12)";
			} else if (line.startsWith("diff --git") || line.startsWith("index ")) {
				row.style.color = "var(--text-faint)";
			}
		}
	}

	private renderSplitDiff(text: string) {
		this.diffEl.empty();

		const grid = this.diffEl.createDiv();
		grid.style.display = "grid";
		grid.style.gridTemplateColumns = "1fr 1fr";
		grid.style.gap = "0";

		const leftHeader = grid.createDiv({ text: "Original" });
		leftHeader.style.padding = "4px 8px";
		leftHeader.style.fontSize = "11px";
		leftHeader.style.color = "var(--text-muted)";
		leftHeader.style.borderBottom = "1px solid var(--background-modifier-border)";
		leftHeader.style.borderRight = "1px solid var(--background-modifier-border)";

		const rightHeader = grid.createDiv({ text: "Changed" });
		rightHeader.style.padding = "4px 8px";
		rightHeader.style.fontSize = "11px";
		rightHeader.style.color = "var(--text-muted)";
		rightHeader.style.borderBottom = "1px solid var(--background-modifier-border)";

		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const next = i + 1 < lines.length ? lines[i + 1] : "";

			if (line.startsWith("@@")) {
				const metaLeft = grid.createDiv({ text: line });
				metaLeft.style.gridColumn = "1 / span 2";
				metaLeft.style.padding = "2px 8px";
				metaLeft.style.color = "var(--color-cyan)";
				metaLeft.style.background = "var(--background-secondary)";
				continue;
			}

			if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
				const meta = grid.createDiv({ text: line });
				meta.style.gridColumn = "1 / span 2";
				meta.style.padding = "2px 8px";
				meta.style.color = "var(--text-faint)";
				continue;
			}

			if (line.startsWith("-") && !line.startsWith("---") && next.startsWith("+") && !next.startsWith("+++")) {
				this.addSplitRow(grid, line.slice(1), next.slice(1), "removed", "added");
				i++;
				continue;
			}

			if (line.startsWith("-") && !line.startsWith("---")) {
				this.addSplitRow(grid, line.slice(1), "", "removed", "normal");
				continue;
			}

			if (line.startsWith("+") && !line.startsWith("+++")) {
				this.addSplitRow(grid, "", line.slice(1), "normal", "added");
				continue;
			}

			if (line.startsWith(" ")) {
				this.addSplitRow(grid, line.slice(1), line.slice(1), "normal", "normal");
				continue;
			}

			if (line.trim().length > 0) {
				this.addSplitRow(grid, line, line, "meta", "meta");
			}
		}
	}

	private addSplitRow(
		grid: HTMLElement,
		leftText: string,
		rightText: string,
		leftKind: "normal" | "removed" | "meta",
		rightKind: "normal" | "added" | "meta"
	) {
		const left = grid.createDiv({ text: leftText.length > 0 ? leftText : " " });
		left.style.padding = "0 8px";
		left.style.borderRight = "1px solid var(--background-modifier-border)";
		left.style.whiteSpace = "pre";

		const right = grid.createDiv({ text: rightText.length > 0 ? rightText : " " });
		right.style.padding = "0 8px";
		right.style.whiteSpace = "pre";

		if (leftKind === "removed") {
			left.style.color = "var(--color-red)";
			left.style.background = "rgba(239, 68, 68, 0.12)";
		} else if (leftKind === "meta") {
			left.style.color = "var(--text-faint)";
		}

		if (rightKind === "added") {
			right.style.color = "var(--color-green)";
			right.style.background = "rgba(34, 197, 94, 0.12)";
		} else if (rightKind === "meta") {
			right.style.color = "var(--text-faint)";
		}
	}
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------

class GitIntegrationSettingTab extends PluginSettingTab {
	plugin: GitIntegrationPlugin;

	constructor(app: App, plugin: GitIntegrationPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Git Integration Settings" });

		// --- Status Bar ---
		new Setting(containerEl)
			.setName("Show status bar")
			.setDesc("Display current branch and file counts in the status bar.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showStatusBar)
					.onChange(async (value) => {
						this.plugin.settings.showStatusBar = value;
						await this.plugin.saveSettings();
						this.plugin.updateStatusBar();
					})
			);

		// --- Commit message ---
		new Setting(containerEl)
			.setName("Default commit message")
			.setDesc("Template for auto-commit messages. Use {{date}} as a placeholder.")
			.addText((text) =>
				text
					.setPlaceholder("vault backup: {{date}}")
					.setValue(this.plugin.settings.defaultCommitMessage)
					.onChange(async (value) => {
						this.plugin.settings.defaultCommitMessage = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Date format ---
		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Format for {{date}} in commit messages. E.g. YYYY-MM-DD HH:mm:ss")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD HH:mm:ss")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value;
						await this.plugin.saveSettings();
					})
			);

		// --- Auto-commit ---
		containerEl.createEl("h3", { text: "Auto-commit" });

		new Setting(containerEl)
			.setName("Enable auto-commit")
			.setDesc("Automatically commit all changes on a schedule.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoCommitEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoCommitEnabled = value;
						await this.plugin.saveSettings();
						this.plugin.rescheduleAutoCommit();
					})
			);

		new Setting(containerEl)
			.setName("Auto-commit interval (minutes)")
			.setDesc("How often to auto-commit. Minimum 1 minute.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 120, 1)
					.setValue(this.plugin.settings.autoCommitIntervalMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.autoCommitIntervalMinutes = value;
						await this.plugin.saveSettings();
						this.plugin.rescheduleAutoCommit();
					})
			);

		new Setting(containerEl)
			.setName("Auto-push after commit")
			.setDesc("Automatically push to remote after each commit (including auto-commits).")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoPushAfterCommit)
					.onChange(async (value) => {
						this.plugin.settings.autoPushAfterCommit = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

// ---------------------------------------------------------------------------
// Main Plugin
// ---------------------------------------------------------------------------

export default class GitIntegrationPlugin extends Plugin {
	settings: GitIntegrationSettings;
	git: SimpleGit;
	private statusBarItem: HTMLElement;
	private autoCommitTimer: ReturnType<typeof setInterval> | null = null;
	private vaultPath: string;

	async onload() {
		await this.loadSettings();

		// Resolve vault path
		this.vaultPath = normalizePath(
			(this.app.vault.adapter as { basePath?: string }).basePath ?? ""
		);

		this.git = simpleGit({
			baseDir: this.vaultPath,
			binary: "git",
			maxConcurrentProcesses: 4,
			trimmed: false,
		});

		// Register sidebar view
		this.registerView(
			GIT_SIDEBAR_VIEW,
			(leaf) => new GitSidebarView(leaf, this)
		);

		// Ribbon icon to open sidebar
		this.addRibbonIcon("git-branch", "Open Git panel", () => {
			this.activateSidebar();
		});

		// Status bar
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Refresh status bar every 30s
		this.registerInterval(
			window.setInterval(() => this.updateStatusBar(), 30_000)
		);

		// --- Commands ---

		this.addCommand({
			id: "git-open-sidebar",
			name: "Open Git sidebar",
			callback: () => this.activateSidebar(),
		});

		this.addCommand({
			id: "git-status",
			name: "Show git status",
			callback: async () => {
				try {
					const status = await this.git.status();
					new GitStatusModal(this.app, status).open();
				} catch (e) {
					this.handleError("get status", e);
				}
			},
		});

		this.addCommand({
			id: "git-review-diff",
			name: "Review changes and diff",
			callback: () => {
				this.gitShowChangesDiffPopup();
			},
		});

		this.addCommand({
			id: "git-stage-all",
			name: "Stage all changes",
			callback: async () => {
				await this.gitStageAll();
				this.refreshSidebar();
			},
		});

		this.addCommand({
			id: "git-commit",
			name: "Commit staged changes",
			callback: async () => {
				await this.gitCommitWithPrompt();
				this.refreshSidebar();
			},
		});

		this.addCommand({
			id: "git-stage-and-commit",
			name: "Stage all and commit",
			callback: async () => {
				const defaultMsg = this.buildCommitMessage();
				new CommitModal(this.app, defaultMsg, async (message) => {
					try {
						await this.git.add(".");
						const result = await this.git.commit(message);
						if (result.summary.changes === 0 && result.summary.insertions === 0) {
							new Notice("Nothing to commit.");
							return;
						}
						new Notice(`Staged and committed: ${message}`);
						if (this.settings.autoPushAfterCommit) {
							await this.gitPush();
						}
						this.updateStatusBar();
						this.refreshSidebar();
					} catch (e) {
						this.handleError("stage & commit", e);
					}
				}).open();
			},
		});

		this.addCommand({
			id: "git-push",
			name: "Push to remote",
			callback: async () => {
				await this.gitPush();
				this.refreshSidebar();
			},
		});

		this.addCommand({
			id: "git-pull",
			name: "Pull from remote",
			callback: async () => {
				await this.gitPull();
				this.refreshSidebar();
			},
		});

		this.addCommand({
			id: "git-fetch",
			name: "Fetch from remote",
			callback: async () => {
				try {
					new Notice("Fetching…");
					await this.git.fetch();
					new Notice("Fetch complete.");
					this.updateStatusBar();
					this.refreshSidebar();
				} catch (e) {
					this.handleError("fetch", e);
				}
			},
		});

		this.addCommand({
			id: "git-log",
			name: "Show git history",
			callback: async () => {
				try {
					const log = await this.git.log({ maxCount: 50 });
					new GitLogModal(this.app, log).open();
				} catch (e) {
					this.handleError("get log", e);
				}
			},
		});

		this.addCommand({
			id: "git-create-branch",
			name: "Create new branch",
			callback: async () => {
				const name = await this.promptText("New branch name:");
				if (!name) return;
				try {
					await this.git.checkoutLocalBranch(name);
					new Notice(`Switched to new branch: ${name}`);
					this.updateStatusBar();
					this.refreshSidebar();
				} catch (e) {
					this.handleError("create branch", e);
				}
			},
		});

		this.addCommand({
			id: "git-discard-all",
			name: "Discard all unstaged changes",
			callback: async () => {
				try {
					await this.git.checkout(["."]);
					new Notice("Discarded all unstaged changes.");
					this.updateStatusBar();
					this.refreshSidebar();
				} catch (e) {
					this.handleError("discard changes", e);
				}
			},
		});

		// Settings tab
		this.addSettingTab(new GitIntegrationSettingTab(this.app, this));

		// Auto-commit
		this.rescheduleAutoCommit();

		console.log("Git Integration plugin loaded.");
	}

	onunload() {
		if (this.autoCommitTimer) {
			clearInterval(this.autoCommitTimer);
		}
		this.app.workspace.detachLeavesOfType(GIT_SIDEBAR_VIEW);
		console.log("Git Integration plugin unloaded.");
	}

	// -------------------------------------------------------------------------
	// Sidebar helpers
	// -------------------------------------------------------------------------

	async activateSidebar() {
		const existing = this.app.workspace.getLeavesOfType(GIT_SIDEBAR_VIEW);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: GIT_SIDEBAR_VIEW, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	refreshSidebar() {
		this.app.workspace.getLeavesOfType(GIT_SIDEBAR_VIEW).forEach((leaf) => {
			if (leaf.view instanceof GitSidebarView) {
				leaf.view.render();
			}
		});
	}

	// -------------------------------------------------------------------------
	// Settings
	// -------------------------------------------------------------------------

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// -------------------------------------------------------------------------
	// Status Bar
	// -------------------------------------------------------------------------

	async updateStatusBar() {
		if (!this.settings.showStatusBar) {
			this.statusBarItem.setText("");
			return;
		}
		try {
			const status = await this.git.status();
			const changed =
				status.modified.length +
				status.not_added.length +
				status.deleted.length +
				status.staged.length;
			const branch = status.current ?? "?";
			this.statusBarItem.setText(
				`⎇ ${branch}${changed > 0 ? ` · ${changed} changed` : ""}`
			);
			this.statusBarItem.title = `Git: ${branch} — click for status`;
		} catch {
			this.statusBarItem.setText("⎇ (no repo)");
		}
	}

	// -------------------------------------------------------------------------
	// Auto-commit
	// -------------------------------------------------------------------------

	rescheduleAutoCommit() {
		if (this.autoCommitTimer) {
			clearInterval(this.autoCommitTimer);
			this.autoCommitTimer = null;
		}
		if (!this.settings.autoCommitEnabled) return;
		const ms = this.settings.autoCommitIntervalMinutes * 60_000;
		this.autoCommitTimer = setInterval(() => this.runAutoCommit(), ms);
	}

	private async runAutoCommit() {
		try {
			const status = await this.git.status();
			const dirty =
				status.modified.length +
				status.not_added.length +
				status.deleted.length;
			if (dirty === 0) return;
			await this.git.add(".");
			const message = this.buildCommitMessage();
			await this.git.commit(message);
			new Notice(`Auto-committed: ${message}`);
			if (this.settings.autoPushAfterCommit) {
				await this.gitPush(true);
			}
			this.updateStatusBar();
		} catch (e) {
			console.error("Git auto-commit failed:", e);
		}
	}

	// -------------------------------------------------------------------------
	// Public git action methods (called by sidebar buttons)
	// -------------------------------------------------------------------------

	async gitStageAll(): Promise<void> {
		try {
			await this.git.add(".");
			new Notice("All changes staged.");
			this.updateStatusBar();
		} catch (e) {
			this.handleError("stage changes", e);
		}
	}

	gitShowChangesDiffPopup(): void {
		new GitChangesDiffModal(this.app, this).open();
	}

	async gitCommitWithPrompt(): Promise<void> {
		const defaultMsg = this.buildCommitMessage();
		return new Promise((resolve) => {
			new CommitModal(this.app, defaultMsg, async (message) => {
				try {
					const result = await this.git.commit(message);
					if (result.summary.changes === 0 && result.summary.insertions === 0) {
						new Notice("Nothing to commit.");
					} else {
						new Notice(`Committed: ${message}`);
						if (this.settings.autoPushAfterCommit) {
							await this.gitPush(true);
						}
						this.updateStatusBar();
					}
				} catch (e) {
					this.handleError("commit", e);
				}
				resolve();
			}).open();
		});
	}

	async gitPush(silent = false): Promise<void> {
		try {
			if (!silent) new Notice("Pushing…");
			await this.git.push();
			new Notice("Push complete.");
			this.updateStatusBar();
		} catch (e) {
			this.handleError("push", e);
		}
	}

	async gitUnstageAll(): Promise<void> {
		try {
			await this.git.reset(["HEAD"]);
			new Notice("All changes unstaged.");
			this.updateStatusBar();
		} catch (e) {
			this.handleError("unstage changes", e);
		}
	}

	async gitPull(): Promise<void> {
		try {
			new Notice("Pulling…");
			const result = await this.git.pull();
			if (result.summary.changes === 0) {
				new Notice("Already up to date.");
			} else {
				new Notice(
					`Pulled: ${result.summary.changes} change(s), ${result.summary.insertions} insertion(s), ${result.summary.deletions} deletion(s).`
				);
			}
			this.updateStatusBar();
		} catch (e) {
			this.handleError("pull", e);
		}
	}

	async getChangedFilesWithKinds(): Promise<GitChangeEntry[]> {
		const status = await this.git.status();
		const entries: GitChangeEntry[] = [];
		const seen = new Set<string>();

		const addEntries = (files: string[], kind: GitChangeKind) => {
			for (const file of files) {
				const key = `${kind}:${file}`;
				if (seen.has(key)) continue;
				entries.push({ path: file, kind });
				seen.add(key);
			}
		};

		addEntries(status.staged, "staged");
		addEntries(status.modified, "modified");
		addEntries(status.not_added, "untracked");
		addEntries(status.deleted, "deleted");
		addEntries(status.conflicted, "conflicted");

		return entries;
	}

	async getDiffForChange(change: GitChangeEntry): Promise<string> {
		if (change.kind === "untracked") {
			return `File: ${change.path}\n\nThis file is untracked. Stage it to view a standard git diff.`;
		}

		if (change.kind === "staged") {
			const cachedDiff = await this.git.diff(["--cached", "--", change.path]);
			return cachedDiff || `No staged diff output for ${change.path}.`;
		}

		const diff = await this.git.diff(["--", change.path]);
		return diff || `No unstaged diff output for ${change.path}.`;
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private buildCommitMessage(): string {
		return this.settings.defaultCommitMessage.replace(
			"{{date}}",
			formatDate(this.settings.dateFormat)
		);
	}

	private handleError(action: string, error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		new Notice(`Git ${action} failed: ${msg}`, 8000);
		console.error(`Git ${action} error:`, error);
	}

	/** Minimal single-line text prompt via a modal. */
	private promptText(label: string): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.contentEl.createEl("p", { text: label });
			const input = modal.contentEl.createEl("input", { type: "text" });
			input.style.width = "100%";
			input.style.marginBottom = "8px";

			const row = modal.contentEl.createDiv();
			row.style.display = "flex";
			row.style.gap = "8px";
			row.style.justifyContent = "flex-end";

			const cancel = row.createEl("button", { text: "Cancel" });
			cancel.addEventListener("click", () => {
				modal.close();
				resolve(null);
			});

			const ok = row.createEl("button", { text: "OK", cls: "mod-cta" });
			ok.addEventListener("click", () => {
				modal.close();
				resolve(input.value.trim() || null);
			});

			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") ok.click();
				if (e.key === "Escape") cancel.click();
			});

			modal.open();
			input.focus();
		});
	}
}
