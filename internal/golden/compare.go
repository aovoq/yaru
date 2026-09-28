package golden

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

type Difference struct {
	Scenario string
	Location string
	Detail   string
}

// Compare は手順の出力と入力、.yaru と状態ディレクトリのファイルを突き合わせる
func Compare(expected Snapshot, actual Snapshot) []Difference {
	scenario := expected.Name
	differences := []Difference{}
	add := func(location string, detail string) {
		differences = append(differences, Difference{Scenario: scenario, Location: location, Detail: detail})
	}
	stepCount := max(len(expected.Steps), len(actual.Steps))
	for index := 0; index < stepCount; index++ {
		if index >= len(expected.Steps) {
			add(stepLocation(index, actual.Steps[index]), "unexpected step")
			continue
		}
		expectedStep := expected.Steps[index]
		location := stepLocation(index, expectedStep)
		if index >= len(actual.Steps) {
			add(location, "missing in actual")
			continue
		}
		actualStep := actual.Steps[index]
		if expectedStep.Stdout != actualStep.Stdout {
			add(location+": stdout", unifiedDiff(expectedStep.Stdout, actualStep.Stdout))
		}
		if expectedStep.Stderr != actualStep.Stderr {
			add(location+": stderr", unifiedDiff(expectedStep.Stderr, actualStep.Stderr))
		}
		if expectedStep.ExitCode != actualStep.ExitCode {
			add(location+": exit code", fmt.Sprintf("expected %d, actual %d", expectedStep.ExitCode, actualStep.ExitCode))
		}
		if expectedStep.Stdin != actualStep.Stdin {
			add(location+": stdin", unifiedDiff(expectedStep.Stdin, actualStep.Stdin))
		}
		expectedEnvironment := environmentText(expectedStep.Environment)
		actualEnvironment := environmentText(actualStep.Environment)
		if expectedEnvironment != actualEnvironment {
			add(location+": environment", unifiedDiff(expectedEnvironment, actualEnvironment))
		}
		if expectedStep.Now != actualStep.Now {
			add(location+": now", fmt.Sprintf("expected %s, actual %s", expectedStep.Now, actualStep.Now))
		}
		if expectedStep.WorkingDirectory != actualStep.WorkingDirectory {
			add(location+": workingDirectory", fmt.Sprintf("expected %s, actual %s", expectedStep.WorkingDirectory, actualStep.WorkingDirectory))
		}
	}
	differences = append(differences, compareFiles(scenario, ".yaru", expected.Yaru, actual.Yaru)...)
	differences = append(differences, compareFiles(scenario, "state", expected.State, actual.State)...)
	return differences
}

// FormatDifferences は場面ごとにまとめ、場所と中身を字下げして並べる
func FormatDifferences(differences []Difference) string {
	if len(differences) == 0 {
		return ""
	}
	lines := []string{}
	currentScenario := ""
	for _, difference := range differences {
		if difference.Scenario != currentScenario {
			currentScenario = difference.Scenario
			lines = append(lines, "scenario "+currentScenario)
		}
		lines = append(lines, "  "+difference.Location)
		for _, line := range strings.Split(difference.Detail, "\n") {
			lines = append(lines, "    "+line)
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

// UnexpectedSnapshots は場面の無い記録を返す
func UnexpectedSnapshots(scenarios []Scenario, snapshotsDirectory string) ([]Difference, error) {
	entries, err := os.ReadDir(snapshotsDirectory)
	if err != nil {
		if os.IsNotExist(err) {
			return []Difference{}, nil
		}
		return nil, err
	}
	scenarioNames := map[string]bool{}
	for _, scenario := range scenarios {
		scenarioNames[scenario.Name] = true
	}
	differences := []Difference{}
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		scenarioName := strings.TrimSuffix(name, ".json")
		if scenarioNames[scenarioName] {
			continue
		}
		differences = append(differences, Difference{
			Scenario: scenarioName,
			Location: "snapshot",
			Detail:   "unexpected snapshot: expected no file, actual " + name,
		})
	}
	return differences, nil
}

func stepLocation(index int, step RecordedStep) string {
	return fmt.Sprintf("step %d (%s)", index+1, strings.Join(step.Arguments, " "))
}

func compareFiles(scenario string, root string, expected []RecordedFile, actual []RecordedFile) []Difference {
	differences := []Difference{}
	actualByPath := map[string]RecordedFile{}
	for _, file := range actual {
		actualByPath[file.Path] = file
	}
	expectedPaths := map[string]bool{}
	for _, file := range expected {
		expectedPaths[file.Path] = true
	}
	for _, file := range expected {
		location := root + "/" + file.Path
		found, present := actualByPath[file.Path]
		if !present {
			differences = append(differences, Difference{Scenario: scenario, Location: location, Detail: "missing in actual"})
			continue
		}
		if found.Directory != file.Directory {
			differences = append(differences, Difference{
				Scenario: scenario,
				Location: location,
				Detail:   fmt.Sprintf("expected %s, actual %s", fileKind(file), fileKind(found)),
			})
		}
		if found.Content != file.Content {
			differences = append(differences, Difference{Scenario: scenario, Location: location, Detail: unifiedDiff(file.Content, found.Content)})
		}
	}
	for _, file := range actual {
		if expectedPaths[file.Path] {
			continue
		}
		differences = append(differences, Difference{Scenario: scenario, Location: root + "/" + file.Path, Detail: "unexpected file"})
	}
	return differences
}

func fileKind(file RecordedFile) string {
	if file.Directory {
		return "a directory"
	}
	return "a file"
}

// environmentText は差分に出すため、キーの順に並べた JSON にする
func environmentText(environment map[string]string) string {
	keys := make([]string, 0, len(environment))
	for key := range environment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return "{}\n"
	}
	lines := []string{"{"}
	for index, key := range keys {
		line := "  " + string(encodeString(key)) + ": " + string(encodeString(environment[key]))
		if index < len(keys)-1 {
			line += ","
		}
		lines = append(lines, line)
	}
	lines = append(lines, "}")
	return strings.Join(lines, "\n") + "\n"
}
