import * as monaco from 'monaco-editor';

export class SimpleLspClient {
  private ws: WebSocket;
  private messageId = 1;
  private pendingRequests = new Map<number, { resolve: (val: any) => void, reject: (err: any) => void }>();
  private model: monaco.editor.ITextModel;

  constructor(url: string, editor: monaco.editor.IStandaloneCodeEditor) {
    this.model = editor.getModel()!;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {
          textDocument: {
            hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
            synchronization: { dynamicRegistration: true, willSave: false, willSaveWaitUntil: false, didSave: false }
          }
        }
      }).then(() => {
        this.sendNotification('initialized', {});
        this.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: 'file:///main.cpp',
            languageId: 'cpp',
            version: 1,
            text: this.model.getValue()
          }
        });
      });
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
        if (msg.error) this.pendingRequests.get(msg.id)!.reject(msg.error);
        else this.pendingRequests.get(msg.id)!.resolve(msg.result);
        this.pendingRequests.delete(msg.id);
      } else if (msg.method === 'textDocument/publishDiagnostics') {
        const diagnostics = msg.params.diagnostics;
        const markers = diagnostics.map((d: any) => ({
          severity: d.severity === 1 ? monaco.MarkerSeverity.Error : 
                    d.severity === 2 ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          message: d.message,
          source: d.source
        }));
        monaco.editor.setModelMarkers(this.model, 'clangd', markers);
      } else if (msg.method === 'custom/downloadProgress') {
        window.dispatchEvent(new CustomEvent('clangd-download-progress', { detail: msg.params.message }));
      }
    };

    this.model.onDidChangeContent(() => {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.sendNotification('textDocument/didChange', {
          textDocument: { uri: 'file:///main.cpp', version: 2 },
          contentChanges: [{ text: this.model.getValue() }]
        });
      }
    });

    monaco.languages.registerHoverProvider('cpp', {
      provideHover: async (_model, position) => {
        if (this.ws.readyState !== WebSocket.OPEN) return null;
        const res = await this.sendRequest('textDocument/hover', {
          textDocument: { uri: 'file:///main.cpp' },
          position: { line: position.lineNumber - 1, character: position.column - 1 }
        });
        if (!res || !res.contents) return null;
        return {
          contents: Array.isArray(res.contents) ? res.contents.map((c: any) => ({ value: c.value })) : [{ value: res.contents.value }],
          range: res.range ? new monaco.Range(res.range.start.line + 1, res.range.start.character + 1, res.range.end.line + 1, res.range.end.character + 1) : undefined
        };
      }
    });
  }

  private sendRequest(method: string, params: any): Promise<any> {
    const id = this.messageId++;
    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    return promise;
  }

  private sendNotification(method: string, params: any) {
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  dispose() {
    this.ws.close();
  }
}
