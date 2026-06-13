import { Extension } from '@tiptap/core';

/**
 * Custom extension that makes Enter in headings create a paragraph
 * instead of continuing the heading. When pressing Enter at the end
 * of H1-H6, the new line becomes normal text (paragraph).
 */
const HeadingExit = Extension.create({
  name: 'headingExit',

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, dispatch } = this.editor.view;
        const { $from, empty } = state.selection;

        // Only intercept when cursor is in a heading and is empty (at end)
        if (empty && $from.parent.type.name === 'heading') {
          const tr = state.tr;
          const paragraph = state.schema.nodes.paragraph;

          // Get position after current heading node
          const posAfter = $from.after();

          // Insert a new paragraph after the heading
          tr.insert(posAfter, paragraph.create());

          // Set cursor at the start of the new paragraph
          const newParaPos = posAfter + 1;
          const SelectionType = state.selection.constructor as any;
          tr.setSelection(SelectionType.near(tr.doc.resolve(newParaPos)));

          if (dispatch) {
            dispatch(tr);
          }
          return true;
        }
        return false;
      },
    };
  },
});

export default HeadingExit;