// ワークスペースの場所 (.yaru のある root) の解決、git の名前、状態ディレクトリ (YARU_STATE_DIR) の登録
// TS 版の src/store.ts の findRoot・open・init・gitName、src/workspaces.ts、src/config.ts、src/provenance.ts に当たる
// 仕様は docs/spec/yaru-format.md の「ディレクトリ」「git の名前」「状態ディレクトリ」
package workspace

// Workspace は開いたワークスペース。Root は getcwd(3) と同じ物理パス、Directory は使う .yaru のパス (git の worktree の中では main worktree の .yaru)
type Workspace struct {
	Root      string
	Directory string
}

// WorkingDirectory は TS 版の process.cwd() と同じ、symlink を解いた物理パスを返す
func WorkingDirectory() (string, error) {
	panic("not implemented: workspace.WorkingDirectory")
}

// Open は TS 版の open と同じ規則で、作業ディレクトリからワークスペースを探して開く
func Open(workingDirectory string) (Workspace, error) {
	panic("not implemented: workspace.Open")
}

// Init は TS 版の init と同じく .yaru を作る
func Init(workingDirectory string) (Workspace, error) {
	panic("not implemented: workspace.Init")
}

// GitName は TS 版の gitName と同じく、作業ディレクトリで git config user.name を読み、空か失敗なら "me" を返す
func GitName(workingDirectory string) string {
	panic("not implemented: workspace.GitName")
}

// Register は TS 版の registerWorkspace と同じく、状態ディレクトリの workspaces.json にワークスペースを載せる
func Register(workspace Workspace) error {
	panic("not implemented: workspace.Register")
}
