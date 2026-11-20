// Single entry for the vendored ProseMirror bundle used by Dua Workspace Notes. Only what the editor needs is exported.
export { Schema, DOMParser as ProseMirrorDOMParser } from 'prosemirror-model';
export { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
export { EditorView } from 'prosemirror-view';
export { baseKeymap, toggleMark, setBlockType, chainCommands, exitCode, joinBackward, selectParentNode } from 'prosemirror-commands';
export { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
export { history, undo, redo } from 'prosemirror-history';
export { keymap } from 'prosemirror-keymap';
export { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules';
