import { Prism } from 'prism-react-renderer';

// prism-react-renderer bundles C++ but not Java; register a compact Java grammar on its Prism instance.
type Grammar = Parameters<typeof Prism.languages.extend>[1];
if (!Prism.languages.java) {
  const keyword =
    /\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|new|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|try|var|void|volatile|while|record|yield)\b/;
  const grammar: Grammar = {
    'class-name': [
      { pattern: /\b[A-Z]\w*(?=\s*(?:<[^<>]*>\s*)?(?:\[\s*\])*\s+\w)/ },
      { pattern: /(\bnew\s+)[A-Z]\w*/, lookbehind: true },
      { pattern: /\b[A-Z][a-z]\w*(?=\s*[.<:])/ },
    ],
    keyword,
    function: /\b\w+(?=\s*\()/,
    number: /\b0x[\da-f]+\b|(?:\b\d+(?:_\d+)*\.?\d*|\B\.\d+)(?:e[+-]?\d+)?[dfl]?/i,
    operator: /->|::|\+\+|--|&&|\|\||>>>?=?|<<=?|[-+*/%&|^!=<>]=?|[?:~]/,
    constant: /\b[A-Z][A-Z_\d]+\b/,
  };
  Prism.languages.java = Prism.languages.extend('clike', grammar);
}
