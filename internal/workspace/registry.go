//declscope:core

package workspace

import (
	"fmt"
	"os"
	"os/user"
	"regexp"
)

// RegisteredWorkspace は workspaces.json の 1 件。TS 版の src/workspaces.ts の Workspace
type RegisteredWorkspace struct {
	Slug string
	Root string
}

// StateDirectory は TS 版の stateDirectory と同じ場所を返す
// 空文字は JavaScript では偽なので、YARU_STATE_DIR にも XDG_STATE_HOME にも入らない
// src/workspaces.ts:18-21 docs/spec/yaru-format.md の「状態ディレクトリ」
// https://specifications.freedesktop.org/basedir-spec/latest/
func StateDirectory() string {
	if directory := os.Getenv("YARU_STATE_DIR"); directory != "" {
		return directory
	}
	base := os.Getenv("XDG_STATE_HOME")
	if base == "" {
		base = nodeJoin(homeDirectory(), ".local", "state")
	}
	return nodeJoin(base, "yaru")
}

func homeDirectory() string {
	if home := os.Getenv("HOME"); home != "" {
		return home
	}
	current, err := user.Current()
	if err != nil {
		return ""
	}
	return current.HomeDir
}

// RegisterIn は TS 版の registerWorkspace(root, directory) と同じく、slug を返す
// 同じ root が既にあればファイルは書き換えない
// src/workspaces.ts:24-39
func RegisterIn(root string, stateDirectory string) (RegisteredWorkspace, error) {
	entries, err := readRegistry(stateDirectory)
	if err != nil {
		return RegisteredWorkspace{}, err
	}
	for _, entry := range entries {
		if entry.root == root {
			return RegisteredWorkspace{Slug: entry.slug, Root: entry.root}, nil
		}
	}
	base := slugify(nodeBasename(root))
	taken := map[string]struct{}{}
	for _, entry := range entries {
		taken[entry.slug] = struct{}{}
	}
	slug := base
	for suffix := 2; slugTaken(taken, slug); suffix++ {
		slug = fmt.Sprintf("%s-%d", base, suffix)
	}
	entries = append(entries, registryEntry{
		slug:   slug,
		root:   root,
		object: newWorkspaceObject(slug, root),
	})
	if err := writeRegistry(stateDirectory, entries); err != nil {
		return RegisteredWorkspace{}, err
	}
	return RegisteredWorkspace{Slug: slug, Root: root}, nil
}

// Slug は root を登録して、URL の /p/<slug>/ に使う名前を返す。既にあればその名前。
// Register は error しか返さないので、CLI の知らせと板の URL はこちらを使う。
// src/workspaces.ts:24-39
func Slug(root string) (string, error) {
	registered, err := RegisterIn(root, StateDirectory())
	if err != nil {
		return "", err
	}
	return registered.Slug, nil
}

func slugTaken(taken map[string]struct{}, slug string) bool {
	_, found := taken[slug]
	return found
}

// List は TS 版の listWorkspaces と同じく、config.yml がまだある登録をファイルの順で返す
// src/workspaces.ts:42-46
func List(stateDirectory string) []RegisteredWorkspace {
	entries, err := readRegistry(stateDirectory)
	if err != nil {
		return []RegisteredWorkspace{}
	}
	listed := make([]RegisteredWorkspace, 0)
	for _, entry := range entries {
		if exists(nodeJoin(entry.root, ".yaru", "config.yml")) {
			listed = append(listed, RegisteredWorkspace{Slug: entry.slug, Root: entry.root})
		}
	}
	return listed
}

// Find は TS 版の findWorkspace と同じく、slug が一致する登録を返す
// src/workspaces.ts:49-50
func Find(slug string, stateDirectory string) (RegisteredWorkspace, bool) {
	for _, workspace := range List(stateDirectory) {
		if workspace.Slug == slug {
			return workspace, true
		}
	}
	return RegisteredWorkspace{}, false
}

type registryEntry struct {
	slug   string
	root   string
	object jsonValue
}

func readRegistry(directory string) ([]registryEntry, error) {
	data, err := os.ReadFile(nodeJoin(directory, "workspaces.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	parsed, err := parseJSON(decodeUTF8(data))
	if err != nil || parsed.kind != jsonObject {
		// 壊れた登録ファイルで CLI 全体を止めない。次の登録で作り直される
		// src/workspaces.ts:68-70
		return nil, nil
	}
	workspaces, found := objectField(parsed, "workspaces")
	if !found || workspaces.kind == jsonNull {
		return nil, nil
	}
	if workspaces.kind != jsonArray {
		return nil, nil
	}
	entries := make([]registryEntry, 0, len(workspaces.elements))
	for _, element := range workspaces.elements {
		slug, slugOK := stringField(element, "slug")
		root, rootOK := stringField(element, "root")
		if !slugOK || !rootOK {
			continue
		}
		entries = append(entries, registryEntry{slug: slug, root: root, object: element})
	}
	return entries, nil
}

func stringField(value jsonValue, key string) (string, bool) {
	field, found := objectField(value, key)
	if !found || field.kind != jsonString {
		return "", false
	}
	return field.text, true
}

func newWorkspaceObject(slug string, root string) jsonValue {
	return jsonValue{
		kind: jsonObject,
		fields: []jsonField{
			{key: "slug", value: jsonValue{kind: jsonString, text: slug}},
			{key: "root", value: jsonValue{kind: jsonString, text: root}},
		},
	}
}

func writeRegistry(directory string, entries []registryEntry) error {
	elements := make([]jsonValue, 0, len(entries))
	for _, entry := range entries {
		elements = append(elements, entry.object)
	}
	registry := jsonValue{
		kind: jsonObject,
		fields: []jsonField{{
			key:   "workspaces",
			value: jsonValue{kind: jsonArray, elements: elements},
		}},
	}
	encoded, err := stringifyJSON(registry)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(directory, 0o777); err != nil {
		return err
	}
	path := nodeJoin(directory, "workspaces.json")
	// 一時ファイルの名前は本体のバイトに影響しない。TS 版は pid を付ける
	// src/workspaces.ts:35-38
	temporary := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(temporary, []byte(encoded+"\n"), 0o666); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}

var nonSlugCharacters = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func slugify(name string) string {
	slug := nonSlugCharacters.ReplaceAllString(name, "-")
	slug = trimHyphenEdges(slug)
	if slug == "" {
		return "workspace"
	}
	return slug
}

func trimHyphenEdges(text string) string {
	start := 0
	end := len(text)
	for start < end && text[start] == '-' {
		start++
	}
	for end > start && text[end-1] == '-' {
		end--
	}
	return text[start:end]
}
