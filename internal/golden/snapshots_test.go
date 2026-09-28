package golden

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

// go test ./internal/golden -update で testdata/golden/snapshots を書き直す
// 1 つの場面だけなら -run 'TestGolden/<場面の名前>$' を足す
var update = flag.Bool("update", false, "rewrite testdata/golden/snapshots from the current CLI")

var (
	buildOnce    sync.Once
	builtCommand string
	buildError   error
)

// ビルドした CLI は一時ディレクトリに置くので、テストの終わりに消す
func TestMain(m *testing.M) {
	flag.Parse()
	code := m.Run()
	if builtCommand != "" {
		_ = os.RemoveAll(filepath.Dir(builtCommand))
	}
	os.Exit(code)
}

// testdata/golden の全部の場面を CLI に流し、記録とバイト単位で突き合わせる
// CLI は YARU_BIN の実行ファイル。無ければ cmd/yaru をビルドして使う
func TestGolden(t *testing.T) {
	repositoryDirectory := repositoryRoot(t)
	scenarios, err := LoadScenarios(filepath.Join(repositoryDirectory, "testdata", "golden", "scenarios"))
	if err != nil {
		t.Fatal(err)
	}
	snapshotsDirectory := filepath.Join(repositoryDirectory, "testdata", "golden", "snapshots")
	runner := Runner{Command: cliCommand(t, repositoryDirectory), RepositoryDirectory: repositoryDirectory}
	for _, scenario := range scenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			t.Parallel()
			actual, err := runner.Run(scenario)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(snapshotsDirectory, scenario.Name+".json")
			if *update {
				if err := os.WriteFile(path, EncodeSnapshot(actual), 0o644); err != nil {
					t.Fatal(err)
				}
				return
			}
			expected, err := ReadSnapshot(path)
			if err != nil {
				t.Fatal(err)
			}
			if differences := Compare(expected, actual); len(differences) > 0 {
				t.Error("\n" + FormatDifferences(differences))
			}
		})
	}
}

// 場面の無い記録は、場面を消したときの消し忘れ
func TestGoldenHasNoSnapshotWithoutScenario(t *testing.T) {
	repositoryDirectory := repositoryRoot(t)
	scenarios, err := LoadScenarios(filepath.Join(repositoryDirectory, "testdata", "golden", "scenarios"))
	if err != nil {
		t.Fatal(err)
	}
	differences, err := UnexpectedSnapshots(scenarios, filepath.Join(repositoryDirectory, "testdata", "golden", "snapshots"))
	if err != nil {
		t.Fatal(err)
	}
	if len(differences) > 0 {
		t.Fatal("\n" + FormatDifferences(differences))
	}
}

func cliCommand(t *testing.T, repositoryDirectory string) string {
	t.Helper()
	if command := os.Getenv("YARU_BIN"); command != "" {
		return command
	}
	buildOnce.Do(func() {
		directory, err := os.MkdirTemp("", "yaru-golden-bin-")
		if err != nil {
			buildError = err
			return
		}
		builtCommand = filepath.Join(directory, "yaru")
		build := exec.Command("go", "build", "-o", builtCommand, "./cmd/yaru")
		build.Dir = repositoryDirectory
		if output, err := build.CombinedOutput(); err != nil {
			buildError = err
			t.Log(string(output))
		}
	})
	if buildError != nil {
		t.Fatal(buildError)
	}
	return builtCommand
}
