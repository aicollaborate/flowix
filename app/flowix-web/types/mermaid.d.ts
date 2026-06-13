declare module 'mermaid/dist/mermaid.core.mjs' {
  export interface MermaidConfig {
    startOnLoad?: boolean;
    theme?: 'default' | 'dark' | 'forest' | 'neutral' | 'null';
    securityLevel?: 'loose' | 'antiscript' | 'strict';
  }

  export interface Mermaid {
    initialize(config?: MermaidConfig): void;
    render(id: string, code: string): Promise<string>;
  }

  const mermaid: Mermaid;
  export default mermaid;
}