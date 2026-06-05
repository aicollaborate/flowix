import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view'
import type { NodeViewRendererProps } from '@tiptap/core'
import { bundledLanguagesInfo } from 'shiki'

export interface CodeBlockShikiViewOptions {
  name: string
  language: string | null
  theme: string
}

class CodeBlockShikiView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  view: NodeViewRendererProps['view']
  node: NodeViewRendererProps['node']
  options: CodeBlockShikiViewOptions
  getPosFn: () => number | null | undefined
  private isDropdownOpen: boolean = false
  private boundCopyHandler: ((e: Event) => void) | null = null

  private header: HTMLElement | null = null
  private languageBtn: HTMLButtonElement | null = null
  private copyBtn: HTMLButtonElement | null = null
  private dropdown: HTMLElement | null = null

  constructor(props: NodeViewRendererProps) {
    const { view, node, getPos } = props
    this.view = view
    this.node = node
    this.getPosFn = getPos
    this.options = {
      name: node.type.name,
      showLineNumbers: node.attrs.showLineNumbers,
      highlightLines: node.attrs.highlightLines,
      language: node.attrs.language,
      theme: node.attrs.theme
    } as any

    this.dom = document.createElement('pre')
    this.contentDOM = document.createElement('code')

    this.createView()
    this.handleEvents()
  }

  private createView() {
    this.dom.classList.add('code-block-wrapper')
    this.dom.setAttribute('data-theme', this.options.theme || 'rose-pine-dawn')

    // Create header
    this.header = document.createElement('div')
    this.header.classList.add('code-block-header')

    // Language selector button
    this.languageBtn = document.createElement('button')
    this.languageBtn.classList.add('code-block-language-selector')
    this.languageBtn.type = 'button'
    this.languageBtn.innerHTML = `<span class="code-block-language-label">${this.node.attrs.language || 'plaintext'}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>`

    // Copy button
    this.copyBtn = document.createElement('button')
    this.copyBtn.classList.add('code-block-copy-btn')
    this.copyBtn.type = 'button'
    this.copyBtn.title = 'Copy code'
    this.copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`

    this.header.appendChild(this.languageBtn)
    this.header.appendChild(this.copyBtn)
    this.dom.appendChild(this.header)

    // Create dropdown for language selection
    this.dropdown = this.createLanguageDropdown()
    this.dom.appendChild(this.dropdown)

    // Code content
    this.contentDOM.classList.add('code-block-content')
    this.dom.appendChild(this.contentDOM)

    this.updateLanguageAttribute()
  }

  private createLanguageDropdown(): HTMLElement {
    const dropdown = document.createElement('div')
    dropdown.classList.add('code-block-language-dropdown')
    dropdown.style.display = 'none'

    // Auto detect option
    const autoItem = document.createElement('button')
    autoItem.classList.add('code-block-language-dropdown-item')
    autoItem.type = 'button'
    autoItem.textContent = 'Auto Detect'
    autoItem.addEventListener('click', () => {
      this.updateLanguage('')
      this.closeDropdown()
    })
    dropdown.appendChild(autoItem)

    // Language options
    const languages = bundledLanguagesInfo.map(lang => ({
      label: lang.name,
      value: lang.id,
    }))

    languages.forEach(({ label, value }) => {
      const item = document.createElement('button')
      item.classList.add('code-block-language-dropdown-item')
      item.type = 'button'
      item.textContent = label
      item.addEventListener('click', () => {
        this.updateLanguage(value)
        this.closeDropdown()
      })
      dropdown.appendChild(item)
    })

    return dropdown
  }

  private toggleDropdown() {
    if (!this.dropdown || !this.languageBtn) return

    if (this.isDropdownOpen) {
      this.closeDropdown()
    } else {
      this.dropdown.style.display = 'block'
      this.isDropdownOpen = true
    }
  }

  private closeDropdown() {
    if (this.dropdown) {
      this.dropdown.style.display = 'none'
      this.isDropdownOpen = false
    }
  }

  private updateLanguage(language: string) {
    const { state, dispatch } = this.view
    const pos = this.getPos()

    if (pos === null) return

    const tr = state.tr.setNodeAttribute(pos, 'language', language)
    dispatch(tr)
    this.updateLanguageButton(language)
  }

  private updateLanguageButton(language: string) {
    if (!this.languageBtn) return

    const label = language || 'plaintext'
    const labelSpan = this.languageBtn.querySelector('.code-block-language-label')
    if (labelSpan) {
      labelSpan.textContent = label
    }
  }

  private updateLanguageAttribute() {
    if (this.node.attrs.language) {
      this.dom.setAttribute('data-language', this.node.attrs.language)
    } else {
      this.dom.removeAttribute('data-language')
    }
  }

  private handleEvents() {
    // Language button click
    this.languageBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleDropdown()
    })

    // Copy button click
    this.copyBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      this.handleCopy()
    })

    // Close dropdown when clicking outside - only if dropdown is open
    document.addEventListener('click', (e) => {
      if (this.isDropdownOpen && !this.dom.contains(e.target as Node)) {
        this.closeDropdown()
      }
    })
  }

  private handleCopy() {
    const code = this.node.textContent

    try {
      navigator.clipboard.writeText(code).then(() => {
        this.showCopySuccess()
      }).catch(() => {
        // Fallback for older browsers
        this.fallbackCopy(code)
      })
    } catch {
      this.fallbackCopy(code)
    }
  }

  private fallbackCopy(text: string) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.top = '-1000px'
    textArea.style.left = '-1000px'
    textArea.style.opacity = '0'
    document.body.appendChild(textArea)
    textArea.select()

    try {
      document.execCommand('copy')
      this.showCopySuccess()
    } catch (err) {
      console.error('Failed to copy:', err)
    }

    document.body.removeChild(textArea)
  }

  private showCopySuccess() {
    if (!this.copyBtn) return

    const originalHTML = this.copyBtn.innerHTML
    this.copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>`
    this.copyBtn.classList.add('copied')

    setTimeout(() => {
      if (this.copyBtn) {
        this.copyBtn.innerHTML = originalHTML
        this.copyBtn.classList.remove('copied')
      }
    }, 2000)
  }

  private getPos(): number | null {
    return typeof this.getPosFn === 'function' ? (this.getPosFn() ?? null) : null;
  }

  update(node: NodeViewRendererProps['node']) {
    if (node.type !== this.node.type) return false

    this.node = node

    // Update language button if changed externally
    const newLang = node.attrs.language || ''
    const currentLang = (this.languageBtn?.querySelector('.code-block-language-label') as HTMLElement)?.textContent || ''
    if (newLang !== currentLang && newLang !== currentLang.replace(/^\s+|\s+$/g, '')) {
      this.updateLanguageButton(newLang)
    }

    this.updateLanguageAttribute()
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    // Ignore mutations in the dropdown or header area
    if (this.dropdown?.contains(mutation.target)) return true
    if (this.header?.contains(mutation.target)) return true
    return false
  }

  destroy() {
    if (this.boundCopyHandler) {
      document.removeEventListener('click', this.boundCopyHandler)
    }
  }
}

export { CodeBlockShikiView }

export function createCodeBlockShikiView(props: NodeViewRendererProps) {
  return new CodeBlockShikiView(props)
}