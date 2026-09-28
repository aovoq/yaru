//declscope:core

package server

import (
	"context"
	"os"
	"path/filepath"
	"time"

	connect "connectrpc.com/connect"
	v1 "github.com/aovoq/yaru/gen/yaru/v1"
	"github.com/aovoq/yaru/internal/workspace"
)

// workspaceWatchService は WatchWorkspace の server stream。
// ready のあと、issues と questions と comments の変化で change、約 5 秒ごとに heartbeat。
// .yaru/questions は作らない。接続のあとでできた comments も change にする。
// docs/spec/routes.md の「ライブ更新」。範囲の出発点は src/web.tsx:316-331。
type workspaceWatchService struct {
	pollInterval time.Duration
	heartbeat    time.Duration
}

func (service *workspaceWatchService) WatchWorkspace(
	ctx context.Context,
	request *connect.Request[v1.WatchWorkspaceRequest],
	stream *connect.ServerStream[v1.WatchWorkspaceResponse],
) error {
	slug := request.Msg.GetWorkspace()
	registered, found := workspace.Find(ctx, slug, stateDirectory())
	if !found {
		return connect.NewError(connect.CodeNotFound, workspaceNotFound(slug))
	}
	yaruDirectory := filepath.Join(registered.Root, ".yaru")
	changes, stop := watchYaruFiles(ctx, yaruDirectory, service.pollInterval)
	defer stop()
	if err := stream.Send(&v1.WatchWorkspaceResponse{Event: &v1.WatchWorkspaceResponse_Ready{Ready: &v1.WatchReady{}}}); err != nil {
		return err
	}
	ticker := time.NewTicker(service.heartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case _, open := <-changes:
			if !open {
				return nil
			}
			if err := stream.Send(&v1.WatchWorkspaceResponse{Event: &v1.WatchWorkspaceResponse_Change{Change: &v1.WatchChange{}}}); err != nil {
				return err
			}
		case <-ticker.C:
			if err := stream.Send(&v1.WatchWorkspaceResponse{Event: &v1.WatchWorkspaceResponse_Heartbeat{Heartbeat: &v1.WatchHeartbeat{}}}); err != nil {
				return err
			}
		}
	}
}

type workspaceMissingError struct {
	slug string
}

func (err workspaceMissingError) Error() string {
	return "workspace not found: " + err.slug
}

func workspaceNotFound(slug string) error {
	return workspaceMissingError{slug: slug}
}

func watchYaruFiles(ctx context.Context, yaruDirectory string, pollInterval time.Duration) (<-chan struct{}, func()) {
	watchContext, cancel := context.WithCancel(ctx)
	changes := make(chan struct{}, 1)
	go func() {
		defer close(changes)
		pollYaruFiles(watchContext, yaruDirectory, pollInterval, changes)
	}()
	return changes, cancel
}

func pollYaruFiles(ctx context.Context, yaruDirectory string, pollInterval time.Duration, changes chan<- struct{}) {
	if pollInterval <= 0 {
		pollInterval = DefaultWatchPoll
	}
	recursive := issuesDirectoryUnavailable(yaruDirectory)
	previous := snapshotWatchedFiles(yaruDirectory, recursive)
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			next := snapshotWatchedFiles(yaruDirectory, recursive)
			if sameSnapshot(previous, next) {
				continue
			}
			previous = next
			select {
			case changes <- struct{}{}:
			default:
			}
		}
	}
}

func issuesDirectoryUnavailable(yaruDirectory string) bool {
	info, err := os.Stat(filepath.Join(yaruDirectory, "issues"))
	if err != nil {
		return true
	}
	return !info.IsDir()
}

type fileIdentity struct {
	size    int64
	modTime int64
	mode    os.FileMode
}

func snapshotWatchedFiles(yaruDirectory string, recursive bool) map[string]fileIdentity {
	recorded := map[string]fileIdentity{}
	if recursive {
		_ = filepath.WalkDir(yaruDirectory, func(filePath string, entry os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			info, infoErr := entry.Info()
			if infoErr != nil {
				return nil
			}
			recorded[filePath] = fileIdentity{size: info.Size(), modTime: info.ModTime().UnixNano(), mode: info.Mode()}
			return nil
		})
		return recorded
	}
	recordFlatDirectory(recorded, filepath.Join(yaruDirectory, "issues"))
	recordFlatDirectory(recorded, filepath.Join(yaruDirectory, "questions"))
	recordFlatDirectory(recorded, filepath.Join(yaruDirectory, "comments"))
	return recorded
}

func recordFlatDirectory(recorded map[string]fileIdentity, directory string) {
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return
	}
	recorded[directory] = fileIdentity{size: info.Size(), modTime: info.ModTime().UnixNano(), mode: info.Mode()}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	for _, entry := range entries {
		entryInfo, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		recorded[filepath.Join(directory, entry.Name())] = fileIdentity{
			size:    entryInfo.Size(),
			modTime: entryInfo.ModTime().UnixNano(),
			mode:    entryInfo.Mode(),
		}
	}
}

func sameSnapshot(left map[string]fileIdentity, right map[string]fileIdentity) bool {
	if len(left) != len(right) {
		return false
	}
	for filePath, identity := range left {
		other, found := right[filePath]
		if !found || other != identity {
			return false
		}
	}
	return true
}
