import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import dts from 'vite-plugin-dts';
// Custom plugin to exclude Excalidraw locales and optimize imports
const optimizeExcalidrawPlugin = () => {
    return {
        name: 'optimize-excalidraw',
        enforce: 'pre',
        resolveId(source, importer) {
            // Block any locale imports from Excalidraw
            if (source.includes('@excalidraw/excalidraw')) {
                if (/locales\/[a-z]{2}-[A-Z]{2}/.test(source)) {
                    return { id: 'virtual:empty-locale', moduleSideEffects: false };
                }
                if (source.endsWith('/locales')) {
                    return { id: 'virtual:empty-locale-index', moduleSideEffects: false };
                }
            }
            return null;
        },
        load(id) {
            if (id === 'virtual:empty-locale') {
                return 'export default {};';
            }
            if (id === 'virtual:empty-locale-index') {
                return 'export default { "en": {} };';
            }
        },
        transform(code, id) {
            // Strip out locale imports from Excalidraw bundle
            if (id.includes('@excalidraw/excalidraw')) {
                let hasChanges = false;
                // Replace dynamic locale imports with empty object
                const dynamicImportRegex = /import\(.+?locales\/[^)]+\)/g;
                if (dynamicImportRegex.test(code)) {
                    code = code.replace(dynamicImportRegex, 'Promise.resolve({default: {}})');
                    hasChanges = true;
                }
                // Replace static locale imports
                const staticImportRegex = /from\s+["']\.\.?\/locales\/[^"']+["']/g;
                if (staticImportRegex.test(code)) {
                    code = code.replace(staticImportRegex, 'from "virtual:empty-locale"');
                    hasChanges = true;
                }
                if (hasChanges) {
                    return { code, map: null };
                }
            }
            return null;
        }
    };
};
export default defineConfig(({ mode }) => ({
    plugins: [
        optimizeExcalidrawPlugin(),
        react(),
        dts({
            insertTypesEntry: true,
            include: ['src'],
            skipDiagnostics: true,
            logDiagnostics: false
        }),
        viteStaticCopy({
            targets: [
                {
                    src: 'src/images/**/*',
                    dest: 'images'
                }
            ]
        }),
    ],
    server: {
        port: 4100,
        host: true,
        // Allow CORS for dev server
        cors: true,
        headers: {
            'Access-Control-Allow-Origin': '*',
        }
    },
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.ts'),
            name: 'StravuEditor',
            fileName: 'index',
            formats: ['es']
        },
        rollupOptions: {
            external: [
                'react',
                'react-dom',
                'lexical',
                /^@lexical\//
            ],
            output: {
                globals: {
                    react: 'React',
                    'react-dom': 'ReactDOM'
                },
                // Manual chunks to split out large dependencies
                manualChunks: (id) => {
                    if (id.includes('prettier')) {
                        return 'prettier';
                    }
                }
            }
        },
        sourcemap: true,
        ...(mode === 'production' && {
            minify: 'terser',
            terserOptions: {
                compress: {
                    toplevel: true,
                },
                keep_classnames: true,
            },
        }),
    },
    optimizeDeps: {
        include: [
            'react',
            'react-dom',
            'lexical',
            '@lexical/react',
            '@lexical/utils',
            '@lexical/rich-text',
            '@lexical/plain-text',
            '@lexical/list',
            '@lexical/link',
            '@lexical/code',
            '@lexical/table',
            '@lexical/selection',
            '@lexical/clipboard',
            '@lexical/file',
            '@lexical/mark',
            '@lexical/markdown',
            '@lexical/overflow',
            '@lexical/hashtag',
            '@lexical/history',
            '@lexical/dragon',
        ],
        exclude: [
            '@excalidraw/excalidraw/locales',
            '@excalidraw/mermaid-to-excalidraw'
        ],
        esbuildOptions: {
            target: 'es2022',
            treeShaking: true,
        },
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@excalidraw/mermaid-to-excalidraw': resolve(__dirname, 'src/mocks/mermaid-mock.ts'),
            // Stub out uncommon Shiki language bundles
            '@shikijs/langs/emacs-lisp': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/wolfram': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/objective-c': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/objective-cpp': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/racket': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/fortran-free-form': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/fortran-fixed-form': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/ocaml': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/stata': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/ada': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/haskell': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/cobol': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/erlang': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/julia': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/crystal': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/system-verilog': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/fsharp': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/vhdl': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/purescript': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/common-lisp': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/nim': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/elixir': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/matlab': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/prolog': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/elm': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/sas': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/scheme': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/smalltalk': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/clojure': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/verilog': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/coq': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/zig': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/tcl': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/pascal': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/lean': resolve(__dirname, 'src/mocks/shiki-lang-stub.js'),
            '@shikijs/langs/mipsasm': resolve(__dirname, 'src/mocks/shiki-lang-stub.js')
        }
    },
    define: {
        // Force production mode for dependencies to avoid dev warnings
        'process.env.NODE_ENV': JSON.stringify(mode || 'development')
    }
}));
