// ワークスペースの場所 (.yaru のある root) の解決、git の名前、状態ディレクトリ (YARU_STATE_DIR) の登録
// TS 版の src/store.ts の findRoot・open・init・gitName、src/workspaces.ts、src/config.ts、src/provenance.ts に当たる
// 仕様は docs/spec/yaru-format.md の「ディレクトリ」「git の名前」「状態ディレクトリ」
//
//declscope:core
package workspace

import (
	"context"
	"os"
	"syscall"

	"github.com/aovoq/yaru/internal/document"
	"github.com/aovoq/yaru/internal/errs"
)

var (
	errNotWorkspace     = errs.Wrap("not a yaru workspace (run yaru init)", errs.ErrNotFound)
	errAlreadyWorkspace = errs.Wrap("already a yaru workspace", errs.ErrConflict)
)

// Workspace は開いたワークスペース。Root は getcwd(3) と同じ物理パス、Directory は使う .yaru のパス (git の worktree の中では main worktree の .yaru)
type Workspace struct {
	Root      string
	Directory string
}

// WorkingDirectory は TS 版の process.cwd() と同じ、symlink を解いた物理パスを返す
// os.Getwd は環境変数 PWD が同じディレクトリを指すとその文字列を返す。Bun の process.cwd() は getcwd(3) なので、こちらを使う
// docs/spec/yaru-format.md の「状態ディレクトリ」
// https://pubs.opengroup.org/onlinepubs/9699919799/functions/getcwd.html
func WorkingDirectory(ctx context.Context) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	directory, err := syscall.Getwd()
	if err != nil {
		return "", err
	}
	return directory, nil
}

// Open は TS 版の open(findRoot(workingDirectory)) と同じ規則で、作業ディレクトリからワークスペースを探して開く
// src/store.ts:121-130 src/store.ts:162-165
func Open(ctx context.Context, workingDirectory string) (Workspace, error) {
	root, err := FindRoot(ctx, workingDirectory)
	if err != nil {
		return Workspace{}, err
	}
	return openRoot(root)
}

func openRoot(root string) (Workspace, error) {
	directory := nodeJoin(root, ".yaru")
	if !exists(nodeJoin(directory, "config.yml")) {
		return Workspace{}, errNotWorkspace
	}
	return Workspace{Root: root, Directory: directory}, nil
}

// Init は TS 版の init と同じく、渡されたディレクトリに .yaru を作る。findRoot は使わない
// src/store.ts:168-174 docs/spec/yaru-format.md の「ディレクトリ」
func Init(ctx context.Context, workingDirectory string) (Workspace, error) {
	if err := ctx.Err(); err != nil {
		return Workspace{}, err
	}
	directory := nodeJoin(workingDirectory, ".yaru")
	if exists(nodeJoin(directory, "config.yml")) {
		return Workspace{}, errAlreadyWorkspace
	}
	// Node の mkdirSync は 0o777、writeFileSync は 0o666。umask はカーネルが掛ける
	if err := os.MkdirAll(nodeJoin(directory, "issues"), 0o777); err != nil {
		return Workspace{}, err
	}
	if err := os.MkdirAll(nodeJoin(directory, "comments"), 0o777); err != nil {
		return Workspace{}, err
	}
	if err := os.WriteFile(nodeJoin(directory, "config.yml"), nil, 0o666); err != nil {
		return Workspace{}, err
	}
	return Workspace{Root: workingDirectory, Directory: directory}, nil
}

// GitName は TS 版の gitName と同じく、作業ディレクトリで git config user.name を読み、空か失敗なら "me" を返す
// 終了コードは見ない。標準出力を trim して空なら me
// src/store.ts:464-468 docs/spec/yaru-format.md の「git の名前」
func GitName(ctx context.Context, workingDirectory string) string {
	stdout, _, err := RunGit(ctx, workingDirectory, "config", "user.name")
	if err != nil {
		return "me"
	}
	name := document.Trim(stdout)
	if name == "" {
		return "me"
	}
	return name
}

// Register は TS 版の registerWorkspace と同じく、状態ディレクトリの workspaces.json にワークスペースを載せる
// src/workspaces.ts:24-39 src/index.ts:733-734
func Register(ctx context.Context, opened Workspace, stateDirectory string) error {
	_, err := RegisterIn(ctx, opened.Root, stateDirectory)
	return err
}
