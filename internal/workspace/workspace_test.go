//declscope:core

package workspace

import (
	"context"
	"github.com/aovoq/yaru/internal/document"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	// テストが本物の ~/.local/state/yaru や HOME を触らないようにする
	// docs/spec/yaru-format.md の「状態ディレクトリ」
	stateDirectory, err := os.MkdirTemp("", "yaru-workspace-state-")
	if err != nil {
		panic(err)
	}
	homeDirectory, err := os.MkdirTemp("", "yaru-workspace-home-")
	if err != nil {
		panic(err)
	}
	mustSetEnvironment("YARU_STATE_DIR", stateDirectory)
	mustSetEnvironment("HOME", homeDirectory)
	if err := os.Unsetenv("XDG_STATE_HOME"); err != nil {
		panic(err)
	}
	mustSetEnvironment("YARU_NOW", "2026-09-28T12:00:00.000Z")
	mustSetEnvironment("TZ", "Asia/Tokyo")
	mustSetEnvironment("GIT_CONFIG_GLOBAL", "/dev/null")
	mustSetEnvironment("GIT_CONFIG_NOSYSTEM", "1")
	mustSetEnvironment("GIT_AUTHOR_NAME", "Yaru Test")
	mustSetEnvironment("GIT_AUTHOR_EMAIL", "yaru-test@example.com")
	mustSetEnvironment("GIT_COMMITTER_NAME", "Yaru Test")
	mustSetEnvironment("GIT_COMMITTER_EMAIL", "yaru-test@example.com")
	code := m.Run()
	if err := os.RemoveAll(stateDirectory); err != nil {
		panic(err)
	}
	if err := os.RemoveAll(homeDirectory); err != nil {
		panic(err)
	}
	os.Exit(code)
}

func mustSetEnvironment(name string, value string) {
	if err := os.Setenv(name, value); err != nil {
		panic(err)
	}
}

func physicalDirectory(t *testing.T) string {
	t.Helper()
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("resolve temp dir: %v", err)
	}
	return directory
}

func runGit(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, output)
	}
}

func initRepository(t *testing.T, root string) {
	t.Helper()
	runGit(t, root, "init", "--quiet", "--initial-branch", "main")
	runGit(t, root, "config", "user.name", "Yaru Test")
	runGit(t, root, "config", "user.email", "yaru-test@example.com")
}

func requireError(t *testing.T, err error, message string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %q", message)
	}
	if err.Error() != message {
		t.Fatalf("error %q, want %q", err.Error(), message)
	}
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func TestInitCreatesTheWorkspaceMarker(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "AsukaTravel")
	workspace, err := Init(context.Background(), root)
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	if workspace.Root != root {
		t.Fatalf("root %q, want %q", workspace.Root, root)
	}
	if workspace.Directory != filepath.Join(root, ".yaru") {
		t.Fatalf("directory %q", workspace.Directory)
	}
	config, err := os.ReadFile(filepath.Join(workspace.Directory, "config.yml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if len(config) != 0 {
		t.Fatalf("config.yml length %d, want 0", len(config))
	}
	for _, name := range []string{"issues", "comments"} {
		info, err := os.Stat(filepath.Join(workspace.Directory, name))
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		if !info.IsDir() {
			t.Fatalf("%s is not a directory", name)
		}
	}
	for _, name := range []string{"events", "questions"} {
		if _, err := os.Stat(filepath.Join(workspace.Directory, name)); !os.IsNotExist(err) {
			t.Fatalf("%s exists, want absent", name)
		}
	}

	opened, err := Open(context.Background(), root)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if opened != workspace {
		t.Fatalf("Open %+v, want %+v", opened, workspace)
	}
}

func TestInitRejectsAnExistingWorkspaceAndKeepsConfigBytes(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "AsukaTravel")
	workspace, err := Init(context.Background(), root)
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	const kept = "notify: keep\n"
	if err := os.WriteFile(filepath.Join(workspace.Directory, "config.yml"), []byte(kept), 0o666); err != nil {
		t.Fatal(err)
	}
	_, err = Init(context.Background(), root)
	requireError(t, err, "already a yaru workspace")
	got, err := os.ReadFile(filepath.Join(workspace.Directory, "config.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != kept {
		t.Fatalf("config %q, want %q", got, kept)
	}
}

func TestInitCreatesMissingParents(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "does-not-exist-yet")
	workspace, err := Init(context.Background(), root)
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	if workspace.Root != root {
		t.Fatalf("root %q, want %q", workspace.Root, root)
	}
	if _, err := os.Stat(filepath.Join(root, ".yaru", "issues")); err != nil {
		t.Fatal(err)
	}
}

func TestOpenWalksUpUntilItFindsConfig(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "AsukaTravel")
	if _, err := Init(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(nested, 0o777); err != nil {
		t.Fatal(err)
	}
	opened, err := Open(context.Background(), nested)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Root != root || opened.Directory != filepath.Join(root, ".yaru") {
		t.Fatalf("opened %+v", opened)
	}
	found, err := FindRoot(context.Background(), filepath.Join(root, "a", "no-such-child"))
	if err != nil {
		t.Fatal(err)
	}
	if found != root {
		t.Fatalf("FindRoot %q, want %q", found, root)
	}
	_, err = Open(context.Background(), filepath.Dir(root))
	requireError(t, err, "not a yaru workspace (run yaru init)")
}

func TestOpenAcceptsADirectoryNamedConfig(t *testing.T) {
	// existsSync はディレクトリでも true。config.yml がディレクトリでも印になる
	// src/store.ts:126 src/store.ts:164
	root := filepath.Join(physicalDirectory(t), "dirmark")
	if err := os.MkdirAll(filepath.Join(root, ".yaru", "config.yml"), 0o777); err != nil {
		t.Fatal(err)
	}
	opened, err := Open(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Root != root {
		t.Fatalf("root %q, want %q", opened.Root, root)
	}
}

func TestFindRootOnAFileReturnsTheTypeScriptSpawnError(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "AsukaTravel")
	if _, err := Init(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "file.txt")
	if err := os.WriteFile(file, []byte("x"), 0o666); err != nil {
		t.Fatal(err)
	}
	_, err := FindRoot(context.Background(), file)
	requireError(t, err, "ENOTDIR: not a directory, posix_spawn 'git'")
	_, err = ReadProvenance(context.Background(), file, map[string]string{})
	requireError(t, err, "ENOTDIR: not a directory, posix_spawn 'git'")
	_, err = ReadProvenance(context.Background(), filepath.Join(root, "missing-dir"), map[string]string{})
	requireError(t, err, "ENOENT: no such file or directory, posix_spawn 'git'")
}

func TestSymlinkPathOutsideGitDoesNotResolveTheTarget(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "AsukaTravel")
	if _, err := Init(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	nested := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(nested, 0o777); err != nil {
		t.Fatal(err)
	}
	parent := physicalDirectory(t)
	link := filepath.Join(parent, "link")
	if err := os.Symlink(nested, link); err != nil {
		t.Fatal(err)
	}
	_, err := FindRoot(context.Background(), link)
	requireError(t, err, "not a yaru workspace (run yaru init)")

	t.Chdir(link)
	t.Setenv("PWD", link)
	workingDirectory, err := WorkingDirectory(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if workingDirectory != nested {
		t.Fatalf("WorkingDirectory %q, want %q", workingDirectory, nested)
	}
	opened, err := Open(context.Background(), workingDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Root != root {
		t.Fatalf("Open root %q, want %q", opened.Root, root)
	}
}

func TestGitNameUsesTheWorkingDirectory(t *testing.T) {
	repository := physicalDirectory(t)
	initRepository(t, repository)
	if got := GitName(context.Background(), repository); got != "Yaru Test" {
		t.Fatalf("GitName %q, want Yaru Test", got)
	}
	runGit(t, repository, "config", "--unset", "user.name")
	if got := GitName(context.Background(), repository); got != "me" {
		t.Fatalf("unset GitName %q, want me", got)
	}
	if got := GitName(context.Background(), physicalDirectory(t)); got != "me" {
		t.Fatalf("outside GitName %q, want me", got)
	}
	if got := GitName(context.Background(), filepath.Join(repository, "missing")); got != "me" {
		t.Fatalf("missing GitName %q, want me", got)
	}
}

func TestReadConfigValue(t *testing.T) {
	root := filepath.Join(physicalDirectory(t), "cfg")
	workspace, err := Init(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if value, ok := ReadConfigValue(context.Background(), workspace, "staleAfter"); ok {
		t.Fatalf("empty config returned %q", value)
	}
	body := "notify: curl -d 'a: b' https://ntfy.sh/x\nstaleAfter:\n  staleAfter: 1h\n# notify: hidden\nnotify: second\npublicUrl: https://example.test/p/\nquote: \"hello\"\n"
	if err := os.WriteFile(filepath.Join(workspace.Directory, "config.yml"), []byte(body), 0o666); err != nil {
		t.Fatal(err)
	}
	assertConfig := func(key string, want string, wantOK bool) {
		t.Helper()
		got, ok := ReadConfigValue(context.Background(), workspace, key)
		if ok != wantOK || got != want {
			t.Fatalf("key %q got %q ok=%v, want %q ok=%v", key, got, ok, want, wantOK)
		}
	}
	assertConfig("notify", "curl -d 'a: b' https://ntfy.sh/x", true)
	assertConfig("staleAfter", "", false)
	assertConfig("missing", "", false)
	assertConfig("publicUrl", "https://example.test/p/", true)
	assertConfig("quote", "\"hello\"", true)
	assertConfig("# notify", "hidden", true)

	if err := os.WriteFile(filepath.Join(workspace.Directory, "config.yml"), []byte("staleAfter: 1h\r\nnotify: x\r\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	assertConfig("staleAfter", "1h", true)
	assertConfig("notify", "x", true)
	if err := os.WriteFile(filepath.Join(workspace.Directory, "config.yml"), []byte("notify:   spaced  \n"), 0o666); err != nil {
		t.Fatal(err)
	}
	assertConfig("notify", "spaced", true)
	if err := os.WriteFile(filepath.Join(workspace.Directory, "config.yml"), []byte("a:b\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	assertConfig("a", "b", true)
	if err := os.Remove(filepath.Join(workspace.Directory, "config.yml")); err != nil {
		t.Fatal(err)
	}
	assertConfig("notify", "", false)
}

func TestStateDirectory(t *testing.T) {
	if got := StateDirectory("/explicit", "/xdg", "/home/tester"); got != "/explicit" {
		t.Fatalf("explicit %q", got)
	}
	if got := StateDirectory("", "/xdg", "/home/tester"); got != "/xdg/yaru" {
		t.Fatalf("xdg %q", got)
	}
	if got := StateDirectory("", "", "/home/tester"); got != "/home/tester/.local/state/yaru" {
		t.Fatalf("home %q", got)
	}
	if got := StateDirectory("relative-state", "", ""); got != "relative-state" {
		t.Fatalf("relative %q", got)
	}
}

func TestRegisterNamesAndBytes(t *testing.T) {
	stateDirectory := physicalDirectory(t)
	roots := []string{
		"/projects/app",
		"/other/app",
		"/projects/my project#1",
		"/projects/やる",
		"/projects/a--b",
		"/projects/--weird--",
		"/projects/café",
		"/projects/a\"b",
		"/",
		"/tmp/😀",
	}
	var slugs []string
	for _, root := range roots {
		registered, err := RegisterIn(context.Background(), root, stateDirectory)
		if err != nil {
			t.Fatalf("register %q: %v", root, err)
		}
		slugs = append(slugs, registered.Slug)
		if registered.Root != root {
			t.Fatalf("root %q, want %q", registered.Root, root)
		}
	}
	wantSlugs := []string{"app", "app-2", "my-project-1", "workspace", "a--b", "weird", "caf", "a-b", "workspace-2", "workspace-3"}
	if len(slugs) != len(wantSlugs) {
		t.Fatalf("slugs %v", slugs)
	}
	for index, slug := range wantSlugs {
		if slugs[index] != slug {
			t.Fatalf("slugs %v, want %v", slugs, wantSlugs)
		}
	}
	again, err := RegisterIn(context.Background(), "/projects/app", stateDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if again.Slug != "app" {
		t.Fatalf("idempotent slug %q", again.Slug)
	}
	got, err := os.ReadFile(filepath.Join(stateDirectory, "workspaces.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"workspaces\": [\n    {\n      \"slug\": \"app\",\n      \"root\": \"/projects/app\"\n    },\n    {\n      \"slug\": \"app-2\",\n      \"root\": \"/other/app\"\n    },\n    {\n      \"slug\": \"my-project-1\",\n      \"root\": \"/projects/my project#1\"\n    },\n    {\n      \"slug\": \"workspace\",\n      \"root\": \"/projects/やる\"\n    },\n    {\n      \"slug\": \"a--b\",\n      \"root\": \"/projects/a--b\"\n    },\n    {\n      \"slug\": \"weird\",\n      \"root\": \"/projects/--weird--\"\n    },\n    {\n      \"slug\": \"caf\",\n      \"root\": \"/projects/café\"\n    },\n    {\n      \"slug\": \"a-b\",\n      \"root\": \"/projects/a\\\"b\"\n    },\n    {\n      \"slug\": \"workspace-2\",\n      \"root\": \"/\"\n    },\n    {\n      \"slug\": \"workspace-3\",\n      \"root\": \"/tmp/😀\"\n    }\n  ]\n}\n"
	if string(got) != want {
		t.Fatalf("workspaces.json\n%s\nwant\n%s", got, want)
	}
	matches, err := filepath.Glob(filepath.Join(stateDirectory, "workspaces.json.*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary files left: %v", matches)
	}
}

func TestRegisterPreservesExtraKeysAndDropsInvalidEntries(t *testing.T) {
	stateDirectory := physicalDirectory(t)
	input := "{\n  \"extra\": true,\n  \"workspaces\": [\n    {\n      \"note\": \"keep\",\n      \"slug\": \"kept\",\n      \"root\": \"/kept\",\n      \"later\": 1.0\n    },\n    {\n      \"root\": \"/order\",\n      \"slug\": \"ordered\"\n    },\n    {\n      \"slug\": 1,\n      \"root\": \"/nope\"\n    },\n    null,\n    {\n      \"slug\": \"missing-root\"\n    },\n    {\n      \"slug\": \"ok\",\n      \"root\": \"/ok\",\n      \"flag\": false,\n      \"text\": \"<&>" + "\u2028" + "\",\n      \"sci\": 1e-7,\n      \"big\": 1e21,\n      \"items\": [1, \"a\", true, null]\n    }\n  ]\n}\n"
	if err := os.WriteFile(filepath.Join(stateDirectory, "workspaces.json"), []byte(input), 0o666); err != nil {
		t.Fatal(err)
	}
	registered, err := RegisterIn(context.Background(), "/projects/Added", stateDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if registered.Slug != "Added" || registered.Root != "/projects/Added" {
		t.Fatalf("registered %+v", registered)
	}
	got, err := os.ReadFile(filepath.Join(stateDirectory, "workspaces.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"workspaces\": [\n    {\n      \"note\": \"keep\",\n      \"slug\": \"kept\",\n      \"root\": \"/kept\",\n      \"later\": 1\n    },\n    {\n      \"root\": \"/order\",\n      \"slug\": \"ordered\"\n    },\n    {\n      \"slug\": \"ok\",\n      \"root\": \"/ok\",\n      \"flag\": false,\n      \"text\": \"<&>" + "\u2028" + "\",\n      \"sci\": 1e-7,\n      \"big\": 1e+21,\n      \"items\": [\n        1,\n        \"a\",\n        true,\n        null\n      ]\n    },\n    {\n      \"slug\": \"Added\",\n      \"root\": \"/projects/Added\"\n    }\n  ]\n}\n"
	if string(got) != want {
		t.Fatalf("preserved\n%s\nwant\n%s", got, want)
	}
}

func TestRegisterCollapsesDuplicateKeysOnTheNextWrite(t *testing.T) {
	stateDirectory := physicalDirectory(t)
	input := "{\"workspaces\":[{\"slug\":\"first\",\"root\":\"/a\",\"slug\":\"second\",\"extra\":true}]}\n"
	if err := os.WriteFile(filepath.Join(stateDirectory, "workspaces.json"), []byte(input), 0o666); err != nil {
		t.Fatal(err)
	}
	if _, err := RegisterIn(context.Background(), "/b", stateDirectory); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(stateDirectory, "workspaces.json"))
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"workspaces\": [\n    {\n      \"slug\": \"second\",\n      \"root\": \"/a\",\n      \"extra\": true\n    },\n    {\n      \"slug\": \"b\",\n      \"root\": \"/b\"\n    }\n  ]\n}\n"
	if string(got) != want {
		t.Fatalf("duplicate keys\n%s\nwant\n%s", got, want)
	}
}

func TestRegisterDoesNotRewriteAnExistingRoot(t *testing.T) {
	stateDirectory := physicalDirectory(t)
	original := "{ \"workspaces\" : [ { \"slug\" : \"custom\" , \"root\" : \"/formatted/root\" } ] }"
	path := filepath.Join(stateDirectory, "workspaces.json")
	if err := os.WriteFile(path, []byte(original), 0o666); err != nil {
		t.Fatal(err)
	}
	registered, err := RegisterIn(context.Background(), "/formatted/root", stateDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if registered.Slug != "custom" {
		t.Fatalf("slug %q", registered.Slug)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != original {
		t.Fatalf("rewrote existing root:\n%s", got)
	}
}

func TestRegisterReplacesACorruptRegistry(t *testing.T) {
	cases := []string{"{", "[]\n", "{\"workspaces\":{\"slug\":\"a\",\"root\":\"b\"}}\n", "{\"workspaces\":null,\"extra\":1}\n", ""}
	for _, input := range cases {
		stateDirectory := physicalDirectory(t)
		if err := os.WriteFile(filepath.Join(stateDirectory, "workspaces.json"), []byte(input), 0o666); err != nil {
			t.Fatal(err)
		}
		registered, err := RegisterIn(context.Background(), "/projects/Fresh", stateDirectory)
		if err != nil {
			t.Fatalf("input %q: %v", input, err)
		}
		if registered.Slug != "Fresh" {
			t.Fatalf("input %q slug %q", input, registered.Slug)
		}
		got, err := os.ReadFile(filepath.Join(stateDirectory, "workspaces.json"))
		if err != nil {
			t.Fatal(err)
		}
		want := "{\n  \"workspaces\": [\n    {\n      \"slug\": \"Fresh\",\n      \"root\": \"/projects/Fresh\"\n    }\n  ]\n}\n"
		if string(got) != want {
			t.Fatalf("input %q rewritten\n%s", input, got)
		}
	}
}

func TestRemovedWorkspaceStaysRegisteredButLeavesTheList(t *testing.T) {
	stateDirectory := physicalDirectory(t)
	first := filepath.Join(physicalDirectory(t), "app")
	second := filepath.Join(physicalDirectory(t), "app")
	third := filepath.Join(physicalDirectory(t), "app")
	for _, root := range []string{first, second} {
		if _, err := Init(context.Background(), root); err != nil {
			t.Fatal(err)
		}
		if _, err := RegisterIn(context.Background(), root, stateDirectory); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.RemoveAll(filepath.Join(first, ".yaru")); err != nil {
		t.Fatal(err)
	}
	listed := List(context.Background(), stateDirectory)
	if len(listed) != 1 || listed[0].Root != second || listed[0].Slug != "app-2" {
		t.Fatalf("list %+v", listed)
	}
	if _, found := Find(context.Background(), "app", stateDirectory); found {
		t.Fatal("removed slug is still listed")
	}
	found, ok := Find(context.Background(), "app-2", stateDirectory)
	if !ok || found.Root != second {
		t.Fatalf("find %+v %v", found, ok)
	}
	if _, err := Init(context.Background(), third); err != nil {
		t.Fatal(err)
	}
	registered, err := RegisterIn(context.Background(), third, stateDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if registered.Slug != "app-3" {
		t.Fatalf("slug %q, want app-3", registered.Slug)
	}
	body, err := os.ReadFile(filepath.Join(stateDirectory, "workspaces.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), first) || !strings.Contains(string(body), second) || !strings.Contains(string(body), third) {
		t.Fatalf("file dropped a root:\n%s", body)
	}
	if len(List(context.Background(), physicalDirectory(t))) != 0 {
		t.Fatal("empty state directory listed a workspace")
	}
	if _, found := Find(context.Background(), "gone", physicalDirectory(t)); found {
		t.Fatal("empty state directory found a slug")
	}
}

func TestNodePathMatchesJavaScript(t *testing.T) {
	if nodeBasename("/") != "" || nodeBasename("") != "" || nodeBasename("/foo/bar/") != "bar" {
		t.Fatalf("basename / %q empty %q slash %q", nodeBasename("/"), nodeBasename(""), nodeBasename("/foo/bar/"))
	}
	if nodeDirname("/tmp/foo/../bar") != "/tmp/foo/.." || nodeDirname("/") != "/" || nodeDirname("") != "." || nodeDirname("foo") != "." || nodeDirname("/foo/") != "/" {
		t.Fatalf("dirname mismatch")
	}
	if nodeJoin("/main", "") != "/main" || nodeJoin("/main", "../x") != "/x" || nodeJoin("/foo", "/bar") != "/foo/bar" || nodeJoin("/a/b", ".yaru", "config.yml") != "/a/b/.yaru/config.yml" {
		t.Fatalf("join mismatch")
	}
	if nodeRelative(context.Background(), "/private/var/x", "/private/var/x") != "" || nodeRelative(context.Background(), "/private/var/x", "/private/var/x/sub") != "sub" || nodeRelative(context.Background(), "/private/var/x", "/private/var/y") != "../y" {
		t.Fatalf("relative mismatch")
	}
	if nodeRelative(context.Background(), "/tmp/foo/../bar", "/tmp/bar") != "" || nodeRelative(context.Background(), "/var/folders/x", "/private/var/folders/x") != "../../../private/var/folders/x" {
		t.Fatalf("relative normalize mismatch")
	}
}

func TestJavaScriptNumberMatchesJSONStringify(t *testing.T) {
	cases := []struct {
		number float64
		text   string
	}{
		{0, "0"},
		{math.Copysign(0, -1), "0"},
		{1, "1"},
		{-1, "-1"},
		{1.5, "1.5"},
		{1e20, "100000000000000000000"},
		{1e21, "1e+21"},
		{1e-6, "0.000001"},
		{1e-7, "1e-7"},
		{0.1, "0.1"},
		{0.3, "0.3"},
		{1.0000000000000002, "1.0000000000000002"},
		{6.02214076e23, "6.02214076e+23"},
		{5e-324, "5e-324"},
		{1.7976931348623157e308, "1.7976931348623157e+308"},
		{9007199254740993, "9007199254740992"},
	}
	for _, testCase := range cases {
		if got := document.FormatJSONNumber(testCase.number); got != testCase.text {
			t.Fatalf("number %v got %s want %s", testCase.number, got, testCase.text)
		}
	}
}

func TestRegisterUsesTheStateDirectory(t *testing.T) {
	stateDirectory := physicalDirectory(t)
	root := filepath.Join(physicalDirectory(t), "AsukaTravel")
	workspace, err := Init(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := Register(context.Background(), workspace, stateDirectory); err != nil {
		t.Fatal(err)
	}
	listed := List(context.Background(), stateDirectory)
	if len(listed) != 1 || listed[0].Slug != "AsukaTravel" || listed[0].Root != root {
		t.Fatalf("list %+v", listed)
	}
}

func TestReadProvenance(t *testing.T) {
	repository := physicalDirectory(t)
	initRepository(t, repository)
	if err := os.WriteFile(filepath.Join(repository, "file.txt"), []byte("x\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	runGit(t, repository, "add", "file.txt")
	runGit(t, repository, "commit", "--quiet", "-m", "init")
	runGit(t, repository, "switch", "--quiet", "-c", "feat/add-thing")
	nested := filepath.Join(repository, "src", "deep")
	if err := os.MkdirAll(nested, 0o777); err != nil {
		t.Fatal(err)
	}
	provenance, err := ReadProvenance(context.Background(), nested, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if provenance.Session != nil || stringValue(provenance.Worktree) != repository || stringValue(provenance.Branch) != "feat/add-thing" {
		t.Fatalf("nested %+v", provenance)
	}

	linked := filepath.Join(physicalDirectory(t), "linked")
	runGit(t, repository, "worktree", "add", "--quiet", "-b", "feat/fix-other", linked)
	provenance, err = ReadProvenance(context.Background(), linked, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Worktree) != linked || stringValue(provenance.Branch) != "feat/fix-other" {
		t.Fatalf("linked %+v", provenance)
	}

	runGit(t, repository, "switch", "--quiet", "--detach")
	provenance, err = ReadProvenance(context.Background(), repository, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Worktree) != repository || provenance.Branch != nil {
		t.Fatalf("detached %+v", provenance)
	}

	outside := physicalDirectory(t)
	provenance, err = ReadProvenance(context.Background(), outside, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if provenance.Session != nil || provenance.Worktree != nil || provenance.Branch != nil {
		t.Fatalf("outside %+v", provenance)
	}

	provenance, err = ReadProvenance(context.Background(), outside, map[string]string{
		"CLAUDE_CODE_SESSION_ID": "claude-1",
		"CODEX_SESSION_ID":       "codex-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Session) != "claude-1" {
		t.Fatalf("session %q", stringValue(provenance.Session))
	}
	provenance, err = ReadProvenance(context.Background(), outside, map[string]string{
		"CLAUDE_CODE_SESSION_ID": "  ",
		"CODEX_SESSION_ID":       "codex-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Session) != "codex-1" {
		t.Fatalf("blank claude session %q", stringValue(provenance.Session))
	}
	provenance, err = ReadProvenance(context.Background(), outside, map[string]string{"CLAUDE_CODE_SESSION_ID": "  abc  "})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Session) != "abc" {
		t.Fatalf("trimmed session %q", stringValue(provenance.Session))
	}
	provenance, err = ReadProvenance(context.Background(), outside, map[string]string{"CODEX_SESSION_ID": "\n codex \n"})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Session) != "codex" {
		t.Fatalf("newline session %q", stringValue(provenance.Session))
	}

	provenance, err = ReadProvenance(context.Background(), outside, map[string]string{"CLAUDE_CODE_SESSION_ID": "from-process", "CODEX_SESSION_ID": "ignored"})
	if err != nil {
		t.Fatal(err)
	}
	if stringValue(provenance.Session) != "from-process" {
		t.Fatalf("process session %q", stringValue(provenance.Session))
	}
}

func TestLinkedWorktreeUsesTheMainWorkspace(t *testing.T) {
	mainRoot := physicalDirectory(t)
	initRepository(t, mainRoot)
	if _, err := Init(context.Background(), mainRoot); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mainRoot, ".yaru", "issues", ".keep"), nil, 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mainRoot, "README.md"), []byte("x\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	runGit(t, mainRoot, "add", ".")
	runGit(t, mainRoot, "commit", "--quiet", "-m", "init")
	worktree := filepath.Join(physicalDirectory(t), "feature")
	runGit(t, mainRoot, "worktree", "add", "--quiet", "-b", "feature", worktree)

	opened, err := Open(context.Background(), worktree)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Root != mainRoot || opened.Directory != filepath.Join(mainRoot, ".yaru") {
		t.Fatalf("worktree opened %+v, want root %s", opened, mainRoot)
	}
	fromDot, err := FindRoot(context.Background(), filepath.Join(worktree, ".yaru"))
	if err != nil {
		t.Fatal(err)
	}
	if fromDot != mainRoot {
		t.Fatalf("FindRoot .yaru %q, want %q", fromDot, mainRoot)
	}
	fromMain, err := FindRoot(context.Background(), mainRoot)
	if err != nil {
		t.Fatal(err)
	}
	if fromMain != mainRoot {
		t.Fatalf("FindRoot main %q", fromMain)
	}
}

func TestSubdirectoryWorkspaceMapsToTheSamePlaceInMain(t *testing.T) {
	mainRoot := physicalDirectory(t)
	initRepository(t, mainRoot)
	workspaceRoot := filepath.Join(mainRoot, "packages", "app")
	if _, err := Init(context.Background(), workspaceRoot); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspaceRoot, ".yaru", "issues", ".keep"), nil, 0o666); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mainRoot, "README.md"), []byte("x\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	runGit(t, mainRoot, "add", ".")
	runGit(t, mainRoot, "commit", "--quiet", "-m", "init")
	worktree := filepath.Join(physicalDirectory(t), "feature")
	runGit(t, mainRoot, "worktree", "add", "--quiet", "-b", "feature", worktree)
	nested := filepath.Join(worktree, "packages", "app", "src")
	if err := os.MkdirAll(nested, 0o777); err != nil {
		t.Fatal(err)
	}
	found, err := FindRoot(context.Background(), nested)
	if err != nil {
		t.Fatal(err)
	}
	if found != workspaceRoot {
		t.Fatalf("mapped %q, want %q", found, workspaceRoot)
	}
	absent := filepath.Join(nested, "missing")
	found, err = FindRoot(context.Background(), absent)
	if err != nil {
		t.Fatal(err)
	}
	if found != filepath.Join(worktree, "packages", "app") {
		t.Fatalf("absent nested %q, want the worktree copy", found)
	}
}

func TestBareWorktreeDoesNotMap(t *testing.T) {
	parent := physicalDirectory(t)
	bare := filepath.Join(parent, "repo.git")
	runGit(t, parent, "init", "--bare", "--quiet", "--initial-branch", "main", bare)
	worktree := filepath.Join(parent, "wt")
	runGit(t, bare, "worktree", "add", "--quiet", "-b", "feature", worktree)
	if _, err := Init(context.Background(), worktree); err != nil {
		t.Fatal(err)
	}
	found, err := FindRoot(context.Background(), worktree)
	if err != nil {
		t.Fatal(err)
	}
	if found != worktree {
		t.Fatalf("bare worktree root %q, want %q", found, worktree)
	}
}

func TestWorktreeWithoutMainYaruFallsBackToItsOwnCopy(t *testing.T) {
	mainRoot := physicalDirectory(t)
	initRepository(t, mainRoot)
	if err := os.WriteFile(filepath.Join(mainRoot, "README.md"), []byte("x\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	runGit(t, mainRoot, "add", ".")
	runGit(t, mainRoot, "commit", "--quiet", "-m", "init")
	worktree := filepath.Join(physicalDirectory(t), "feature")
	runGit(t, mainRoot, "worktree", "add", "--quiet", "-b", "feature", worktree)
	if _, err := Init(context.Background(), worktree); err != nil {
		t.Fatal(err)
	}
	found, err := FindRoot(context.Background(), worktree)
	if err != nil {
		t.Fatal(err)
	}
	if found != worktree {
		t.Fatalf("fallback %q, want %q", found, worktree)
	}
}

func TestInitInsideALinkedWorktreeSubdirectoryIsHiddenByMain(t *testing.T) {
	// findRoot は写像が当たると、worktree 側に今作った .yaru より main を返す
	// src/store.ts:121-129 docs/spec/yaru-format.md の「worktree」の未決 11
	mainRoot := physicalDirectory(t)
	initRepository(t, mainRoot)
	if _, err := Init(context.Background(), mainRoot); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mainRoot, "README.md"), []byte("x\n"), 0o666); err != nil {
		t.Fatal(err)
	}
	runGit(t, mainRoot, "add", ".")
	runGit(t, mainRoot, "commit", "--quiet", "-m", "init")
	worktree := filepath.Join(physicalDirectory(t), "feature")
	runGit(t, mainRoot, "worktree", "add", "--quiet", "-b", "feature", worktree)
	nested := filepath.Join(worktree, "pkg")
	created, err := Init(context.Background(), nested)
	if err != nil {
		t.Fatal(err)
	}
	if created.Root != nested {
		t.Fatalf("Init root %q, want %q", created.Root, nested)
	}
	opened, err := Open(context.Background(), nested)
	if err != nil {
		t.Fatal(err)
	}
	if opened.Root != mainRoot {
		t.Fatalf("Open root %q, want main %q", opened.Root, mainRoot)
	}
}
