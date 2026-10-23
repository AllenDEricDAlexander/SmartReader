import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';
import { AiService } from './ai/aiService';
import { LibraryService } from './library/libraryService';
import { createLibraryStorage } from './library/libraryStorage';
import { isTauriRuntimeAvailable } from './platform/tauriRuntime';
import { installAiShutdownHandler } from './platform/aiShutdown';

// Desktop services have one lifetime outside React StrictMode's effect replay.
const library = isTauriRuntimeAvailable() ? new LibraryService(createLibraryStorage()) : null;
const research = library ? { library, ai: new AiService(library) } : undefined;
if (research) void installAiShutdownHandler(research.ai).catch((error) => research.ai.reportShutdownFailure(error));
window.addEventListener('beforeunload', () => research?.ai.dispose());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App research={research} />
  </React.StrictMode>,
);
