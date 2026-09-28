//declscope:namespace issue

package store

import (
	"fmt"
	"reflect"
	"strings"

	"github.com/aovoq/yaru/internal/document"
)

// 本文の部分更新。失敗した操作があると、それより前の操作もファイルには残さない。
// src/store.ts:870-991、docs/spec/yaru-format.md の「本文」。

const issuePatchOperationMinimum = 1
const issuePatchOperationMaximum = 50

var issuePatchOperations = []string{"replace", "insert_before", "insert_after", "prepend", "append", "replace_range"}

// PatchOp は本文へ順に適用する 1 操作。src/store.ts:72-78
type PatchOp struct {
	Op         string
	OldString  string
	NewString  string
	ReplaceAll bool
	Anchor     string
	Text       string
	From       string
	To         string
}

// absent は JSON のオブジェクトにキーが無いこと。null とは分けて、TS の undefined に合わせる。
type issueAbsent struct{}

// ParsePatch は 1 件から 50 件の操作配列だけを受ける。src/store.ts:879-928
func ParsePatch(value any) ([]PatchOp, error) {
	items, ok := issueSliceItems(value)
	if !ok {
		actual, err := issueActualValue(value)
		if err != nil {
			return nil, err
		}
		return nil, issueErrString("invalid patch: expected a JSON array of operations, actual " + actual)
	}
	if len(items) < issuePatchOperationMinimum || len(items) > issuePatchOperationMaximum {
		return nil, issueErrString(fmt.Sprintf("invalid patch: expected 1 to 50 operations, actual %d", len(items)))
	}
	operations := make([]PatchOp, 0, len(items))
	for _, item := range items {
		operation, err := issueParsePatchOp(item)
		if err != nil {
			return nil, err
		}
		operations = append(operations, operation)
	}
	return operations, nil
}

func issueParsePatchOp(value any) (PatchOp, error) {
	object, ok := issueObjectFields(value)
	if !ok {
		actual, err := issueActualValue(value)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{}, issueErrString("invalid patch: expected an operation object, actual " + actual)
	}
	op, exists := object["op"]
	opText, opIsString := op.(string)
	if !exists || !opIsString {
		return PatchOp{}, issueErrString("invalid patch: op is required")
	}
	switch opText {
	case "replace":
		oldString, err := issueRequiredText(object, "old_string", "replace", 1)
		if err != nil {
			return PatchOp{}, err
		}
		newString, err := issueRequiredText(object, "new_string", "replace", 0)
		if err != nil {
			return PatchOp{}, err
		}
		operation := PatchOp{Op: opText, OldString: oldString, NewString: newString}
		if _, present := object["replace_all"]; present {
			replaceAll, err := issueRequiredBoolean(object, "replace_all", "replace")
			if err != nil {
				return PatchOp{}, err
			}
			operation.ReplaceAll = replaceAll
		}
		return operation, nil
	case "insert_before", "insert_after":
		anchor, err := issueRequiredText(object, "anchor", opText, 1)
		if err != nil {
			return PatchOp{}, err
		}
		text, err := issueRequiredText(object, "text", opText, 1)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{Op: opText, Anchor: anchor, Text: text}, nil
	case "prepend", "append":
		text, err := issueRequiredText(object, "text", opText, 1)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{Op: opText, Text: text}, nil
	case "replace_range":
		from, err := issueRequiredText(object, "from", "replace_range", 1)
		if err != nil {
			return PatchOp{}, err
		}
		to, err := issueRequiredText(object, "to", "replace_range", 1)
		if err != nil {
			return PatchOp{}, err
		}
		newString, err := issueRequiredText(object, "new_string", "replace_range", 0)
		if err != nil {
			return PatchOp{}, err
		}
		return PatchOp{Op: opText, From: from, To: to, NewString: newString}, nil
	default:
		return PatchOp{}, issueErrString("invalid patch: expected op " + JoinOr(issuePatchOperations) + ", actual " + opText)
	}
}

func issueApplyPatch(body string, operations []PatchOp) (string, error) {
	content := body
	for _, operation := range operations {
		next, err := issueApplyPatchOp(content, operation)
		if err != nil {
			return "", err
		}
		content = next
	}
	return content, nil
}

func issueApplyPatchOp(content string, operation PatchOp) (string, error) {
	switch operation.Op {
	case "replace":
		count := issueMatchCount(content, operation.OldString)
		if operation.ReplaceAll {
			if count < 1 {
				return "", fmt.Errorf("patch replace: old_string must match the current body at least once, expected 1 or more matches, actual %d", count)
			}
			return strings.ReplaceAll(content, operation.OldString, operation.NewString), nil
		}
		if err := issueRequireUnique(count, "replace", "old_string"); err != nil {
			return "", err
		}
		index := strings.Index(content, operation.OldString)
		return content[:index] + operation.NewString + content[index+len(operation.OldString):], nil
	case "insert_before", "insert_after":
		if err := issueRequireUnique(issueMatchCount(content, operation.Anchor), operation.Op, "anchor"); err != nil {
			return "", err
		}
		index := strings.Index(content, operation.Anchor)
		if operation.Op == "insert_before" {
			return content[:index] + operation.Text + content[index:], nil
		}
		end := index + len(operation.Anchor)
		return content[:end] + operation.Text + content[end:], nil
	case "prepend":
		return operation.Text + content, nil
	case "append":
		return content + operation.Text, nil
	default:
		if err := issueRequireUnique(issueMatchCount(content, operation.From), "replace_range", "from"); err != nil {
			return "", err
		}
		fromIndex := strings.Index(content, operation.From)
		afterFrom := fromIndex + len(operation.From)
		rest := content[afterFrom:]
		toCount := issueMatchCount(rest, operation.To)
		if toCount != 1 {
			return "", fmt.Errorf("patch replace_range: to must match the current body exactly once after from, expected 1 match, actual %d", toCount)
		}
		toIndex := afterFrom + strings.Index(rest, operation.To)
		return content[:fromIndex] + operation.NewString + content[toIndex:], nil
	}
}

func issueRequireUnique(count int, op string, field string) error {
	if count != 1 {
		return fmt.Errorf("patch %s: %s must match the current body exactly once, expected 1 match, actual %d", op, field, count)
	}
	return nil
}

func issueMatchCount(haystack string, needle string) int {
	if needle == "" {
		return 0
	}
	count := 0
	from := 0
	for from <= len(haystack)-len(needle) {
		index := strings.Index(haystack[from:], needle)
		if index < 0 {
			return count
		}
		count++
		from += index + len(needle)
	}
	return count
}

func issueRequiredText(object map[string]any, key string, op string, minimum int) (string, error) {
	field := issueLookupField(object, key)
	text, ok := field.(string)
	if !ok || len([]rune(text)) < minimum {
		actual, err := issueActualValue(field)
		if err != nil {
			return "", err
		}
		kind := "string"
		if minimum > 0 {
			kind = "non-empty string"
		}
		return "", issueErrString("invalid patch " + op + ": " + key + " must be a " + kind + ", actual " + actual)
	}
	return text, nil
}

func issueRequiredBoolean(object map[string]any, key string, op string) (bool, error) {
	field := issueLookupField(object, key)
	value, ok := field.(bool)
	if !ok {
		actual, err := issueActualValue(field)
		if err != nil {
			return false, err
		}
		return false, issueErrString("invalid patch " + op + ": " + key + " must be a boolean, actual " + actual)
	}
	return value, nil
}

func issueLookupField(object map[string]any, key string) any {
	value, ok := object[key]
	if !ok {
		return issueAbsent{}
	}
	return value
}

func issueSliceItems(value any) ([]any, bool) {
	if value == nil {
		return nil, false
	}
	if _, ok := value.(issueAbsent); ok {
		return nil, false
	}
	reflected := reflect.ValueOf(value)
	if !reflected.IsValid() || reflected.Kind() != reflect.Slice {
		return nil, false
	}
	items := make([]any, reflected.Len())
	for index := 0; index < reflected.Len(); index++ {
		items[index] = reflected.Index(index).Interface()
	}
	return items, true
}

func issueObjectFields(value any) (map[string]any, bool) {
	if value == nil {
		return nil, false
	}
	if object, ok := value.(map[string]any); ok {
		return object, true
	}
	reflected := reflect.ValueOf(value)
	if !reflected.IsValid() || reflected.Kind() != reflect.Map || reflected.Type().Key().Kind() != reflect.String {
		return nil, false
	}
	object := make(map[string]any, reflected.Len())
	for _, key := range reflected.MapKeys() {
		object[key.String()] = reflected.MapIndex(key).Interface()
	}
	return object, true
}

func issueActualValue(value any) (string, error) {
	if _, ok := value.(issueAbsent); ok {
		return "undefined", nil
	}
	if value == nil {
		return "null", nil
	}
	switch typed := value.(type) {
	case string:
		return document.Quote(typed)
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return document.FormatNumber(issueAsFloatUnchecked(typed)), nil
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Slice, reflect.Array:
		return "array", nil
	case reflect.Map, reflect.Struct:
		return "object", nil
	default:
		return fmt.Sprint(value), nil
	}
}

func issueAsFloatUnchecked(value any) float64 {
	number, _ := issueAsFloat(value)
	return number
}
