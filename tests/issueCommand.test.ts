import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearPendingFileContext, getPendingFileContext } from '../src/controller/state/index.js';

// child_process モック
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

// chalk をパススルー（ANSIコード除去）
vi.mock('chalk', () => {
  const passthrough = (s: unknown) => String(s);
  const builder: Record<string, unknown> = {};
  const methods = [
    'cyan', 'green', 'red', 'blue', 'gray', 'yellow', 'magenta',
    'bold', 'white', 'dim',
  ];
  for (const m of methods) {
    builder[m] = passthrough;
    (passthrough as Record<string, unknown>)[m] = passthrough;
  }
  return { default: builder };
});

import { handleIssueCommand } from '../src/controller/command/issueCommand.js';
import { execSync, spawnSync } from 'node:child_process';

const mockExecSync = execSync as ReturnType<typeof vi.fn>;
const mockSpawnSync = spawnSync as ReturnType<typeof vi.fn>;

const ISSUE_DETAIL = {
  number: 42,
  title: 'バグ修正: ログイン失敗',
  state: 'OPEN',
  body: 'ログイン時にエラーが発生する。\n再現手順:\n1. ログインページを開く\n2. 送信する',
  author: { login: 'alice' },
  labels: [{ name: 'bug' }, { name: 'priority:high' }],
  assignees: [{ login: 'bob' }],
  url: 'https://github.com/org/repo/issues/42',
  createdAt: '2024-01-01T00:00:00Z',
};

const ISSUE_LIST = [
  {
    number: 1,
    title: 'Issue 1',
    state: 'OPEN',
    author: { login: 'alice' },
    labels: [],
    url: 'https://github.com/org/repo/issues/1',
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    number: 2,
    title: 'Issue 2',
    state: 'OPEN',
    author: { login: 'bob' },
    labels: [{ name: 'enhancement' }],
    url: 'https://github.com/org/repo/issues/2',
    createdAt: '2024-01-02T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingFileContext();
  // デフォルト: gh が利用可能
  mockExecSync.mockReturnValue(undefined);
});

afterEach(() => {
  clearPendingFileContext();
});

// ─── handleIssueCommand ルーティング ─────────────────────────────────────────

describe('handleIssueCommand — ルーティング', () => {
  it('引数なしの場合は使用法を表示して true を返す', () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    const result = handleIssueCommand('/issue');

    expect(result).toBe(true);
    expect(logs.some(l => l.includes('使用法'))).toBe(true);

    vi.restoreAllMocks();
  });

  it('gh が利用不能な場合はエラーを表示して true を返す', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    const result = handleIssueCommand('/issue 42');

    expect(result).toBe(true);
    expect(logs.some(l => l.includes('gh'))).toBe(true);

    vi.restoreAllMocks();
  });

  it('不明なサブコマンドの場合は警告を表示して true を返す', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify(ISSUE_DETAIL), stderr: '' });
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    const result = handleIssueCommand('/issue unknown-cmd');

    expect(result).toBe(true);
    expect(logs.some(l => l.includes('unknown-cmd'))).toBe(true);

    vi.restoreAllMocks();
  });
});

// ─── handleIssueView ─────────────────────────────────────────────────────────

describe('handleIssueCommand — Issue取得 (/issue <番号>)', () => {
  it('正常なIssueを取得してコンテキストに注入する', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(ISSUE_DETAIL),
      stderr: '',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    const ctx = getPendingFileContext();
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('GitHub Issue #42');
    expect(ctx).toContain('バグ修正: ログイン失敗');
    expect(ctx).toContain('OPEN');
    expect(ctx).toContain('alice');
    expect(ctx).toContain('ログイン時にエラーが発生する');

    vi.restoreAllMocks();
  });

  it('コンテキストにラベルが含まれる', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(ISSUE_DETAIL),
      stderr: '',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    const ctx = getPendingFileContext();
    expect(ctx).toContain('bug');
    expect(ctx).toContain('priority:high');

    vi.restoreAllMocks();
  });

  it('担当者がコンテキストに含まれる', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(ISSUE_DETAIL),
      stderr: '',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    const ctx = getPendingFileContext();
    expect(ctx).toContain('bob');

    vi.restoreAllMocks();
  });

  it('担当者なしの場合はコンテキストに「なし」が含まれる', () => {
    const issueNoAssignee = { ...ISSUE_DETAIL, assignees: [] };
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(issueNoAssignee),
      stderr: '',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    const ctx = getPendingFileContext();
    expect(ctx).toContain('なし');

    vi.restoreAllMocks();
  });

  it('ラベルなしの場合はコンテキストにラベル行が含まれない', () => {
    const issueNoLabels = { ...ISSUE_DETAIL, labels: [] };
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(issueNoLabels),
      stderr: '',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    const ctx = getPendingFileContext();
    expect(ctx).not.toContain('ラベル:');

    vi.restoreAllMocks();
  });

  it('本文なしのIssueでも「（本文なし）」がコンテキストに含まれる', () => {
    const issueNoBody = { ...ISSUE_DETAIL, body: '' };
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(issueNoBody),
      stderr: '',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    const ctx = getPendingFileContext();
    expect(ctx).toContain('（本文なし）');

    vi.restoreAllMocks();
  });

  it('Issue が見つからない場合はコンテキストを設定しない', () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Could not resolve to an issue with the number of 999.',
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 999');

    expect(getPendingFileContext()).toBeNull();

    vi.restoreAllMocks();
  });

  it('その他のエラーの場合はコンテキストを設定しない', () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'network error',
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 1');

    expect(getPendingFileContext()).toBeNull();

    vi.restoreAllMocks();
  });

  it('JSONパース失敗の場合はコンテキストを設定しない', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'invalid json{{{',
      stderr: '',
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue 42');

    expect(getPendingFileContext()).toBeNull();

    vi.restoreAllMocks();
  });
});

// ─── handleIssueList ─────────────────────────────────────────────────────────

describe('handleIssueCommand — Issue一覧 (/issue list)', () => {
  it('Issue一覧を表示してコンテキストを変更しない', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify(ISSUE_LIST),
      stderr: '',
    });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    const result = handleIssueCommand('/issue list');

    expect(result).toBe(true);
    expect(getPendingFileContext()).toBeNull();
    expect(logs.some(l => l.includes('Issue 1'))).toBe(true);
    expect(logs.some(l => l.includes('Issue 2'))).toBe(true);

    vi.restoreAllMocks();
  });

  it('Issue が0件の場合は「オープンなIssueはありません」を表示する', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([]),
      stderr: '',
    });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));

    handleIssueCommand('/issue list');

    expect(logs.some(l => l.includes('オープンなIssueはありません'))).toBe(true);

    vi.restoreAllMocks();
  });

  it('一覧取得エラー時にエラーメッセージを表示する', () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'authentication required',
    });

    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue list');

    expect(errors.some(e => e.includes('authentication required'))).toBe(true);

    vi.restoreAllMocks();
  });

  it('JSONパース失敗時にエラーメッセージを表示する', () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'not-json',
      stderr: '',
    });

    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.join(' ')));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    handleIssueCommand('/issue list');

    expect(errors.some(e => e.includes('パース'))).toBe(true);

    vi.restoreAllMocks();
  });
});
