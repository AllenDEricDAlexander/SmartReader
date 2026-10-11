import { ReaderApp } from './ReaderApp';
import type { ReaderAppProps } from './appTypes';
import { ResearchContext } from './ResearchContext';

export function App(props: ReaderAppProps) {
  return <ResearchContext.Provider value={props.research ?? null}><ReaderApp {...props} /></ResearchContext.Provider>;
}
