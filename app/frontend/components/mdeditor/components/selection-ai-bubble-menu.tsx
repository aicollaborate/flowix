import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react/menus';
import { SparkleIcon } from '@phosphor-icons/react';
import { useSettingsStore } from '../../../lib/store';
import { useChatStore } from '../../../lib/store/chat-store';

interface SelectionAIBubbleMenuProps {
  editor: Editor;
}

/**
 * Floating bubble menu that appears whenever the user has a non-empty text
 * selection. A single "使用AI询问" button stages the selected text into the
 * chat store and reveals the right-hand AI panel — the input box picks up
 * the staged prompt on its next render.
 */
export function SelectionAIBubbleMenu({ editor }: SelectionAIBubbleMenuProps) {
  const setAgentPanelVisible = useSettingsStore((state) => state.setAgentPanelVisible);
  const setPendingPrompt = useChatStore((state) => state.setPendingPrompt);
  const setPendingCitation = useChatStore((state) => state.setPendingCitation);

  const handleAskAI = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = editor.state.doc.textBetween(from, to, '\n').trim();
    if (!selectedText) return;

    // Stage the selection as a citation (rendered as a card above the input
    // and emitted in the outgoing user message wrapped in
    // <citation>…</citation>). The prompt itself is left empty so the user
    // types their own follow-up question; the inputbox effect still runs
    // to focus the textarea and reset its height.
    setPendingCitation(selectedText);
    setPendingPrompt("");
    setAgentPanelVisible(true);

    // Clear the editor's text selection. We do three things, in order, to make
    // sure neither the document state nor the browser surface still shows a
    // highlighted range after the user has handed the content off to the AI
    // panel:
    //   1. Blur the editor so the bubble menu (which keys off focus + a
    //      non-empty range selection) tears down immediately.
    //   2. Collapse the ProseMirror selection to a single caret position at
    //      `to`, so refocusing the editor later lands the cursor at the end
    //      of where the selection was — instead of restoring the range and
    //      re-popping the bubble menu.
    //   3. Drop the browser's native `Selection` ranges to clear the visual
    //      blue highlight on the page.
    editor.commands.blur();
    editor.commands.setTextSelection(to);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="selectionAIBubbleMenu"
      shouldShow={({ from, to }) => {
        if (from === to) return false;
        if (!editor.isEditable) return false;
        // Suppress on node-only selections (images, tables, …) where the
        // dedicated bubble menus already provide the right actions. The menu
        // still appears for cross-block text selections — `textBetween` joins
        // them with `\n`, which is exactly what we want to hand to the AI.
        if (editor.isActive('image')) return false;
        return true;
      }}
      options={{
        placement: 'top',
        flip: true,
        shift: true,
        offset: 8,
      }}
    >
      <div className="selection-ai-bubble-menu">
        <button
          type="button"
          className="selection-ai-bubble-button"
          onMouseDown={(e) => {
            // Keep editor focus through the click so the menu doesn't tear
            // down before our handler runs; we blur explicitly in the click.
            e.preventDefault();
          }}
          onClick={handleAskAI}
          title="使用 AI 询问选中内容"
        >
          <SparkleIcon className="selection-ai-bubble-icon" size={12} weight="fill" />
          <span className="selection-ai-bubble-label">使用AI询问</span>
        </button>
      </div>
    </BubbleMenu>
  );
}
