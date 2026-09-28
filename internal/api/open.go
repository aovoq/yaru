//declscope:core
package api

import (
	"fmt"

	"github.com/aovoq/yaru/internal/questions"
	"github.com/aovoq/yaru/internal/store"
	"github.com/aovoq/yaru/internal/workspace"
)

// openRegistered は登録の slug からワークスペースを開く。無い slug は TS 版と同じ文。
// src/web.tsx:564-574 、src/workspaces.ts:49-50 。
func openRegistered(stateDirectory string, slug string) (workspace.Workspace, error) {
	registered, found := workspace.Find(slug, stateDirectory)
	if !found {
		return workspace.Workspace{}, fmt.Errorf("workspace not found: %s", slug)
	}
	return workspace.Open(registered.Root)
}

func questionDirectory(opened workspace.Workspace) questions.Directory {
	return questions.Directory{Dir: opened.Directory}
}

// storeIssues は質問の期限後の回答を、issue のコメントへ写す。
// src/questions.ts:236-245 、src/store.ts:661-662 。
type storeIssues struct {
	space workspace.Workspace
}

func (records storeIssues) GetIssue(directory questions.Directory, id string) error {
	_, err := store.GetIssue(records.space, id, nil)
	return err
}

func (records storeIssues) SaveComment(directory questions.Directory, issueID string, body string) error {
	_, err := store.SaveComment(records.space.Directory, store.SaveCommentInput{
		Issue: &issueID,
		Body:  &body,
	})
	return err
}
