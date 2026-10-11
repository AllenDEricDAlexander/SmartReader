import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryService } from '../library/libraryService';
import { emptyMetadata, type LibrarySnapshot } from '../library/libraryModels';
import { AiService, type AiAnswer } from './aiService';
import { AiAssistant } from './AiAssistant';

async function setup(configured = true) {
  let data: LibrarySnapshot | null = null;
  let revision = 0;
  const files = new Map<string, Uint8Array>();
  const library = new LibraryService({
    load: async () => ({ revision, data: structuredClone(data) }),
    commit: async (_expected, next, writes) => {
      for (const write of writes) write.bytes ? files.set(write.id, write.bytes.slice()) : files.delete(write.id);
      data = structuredClone(next);
      return ++revision;
    },
    readFile: async (id) => files.get(id)!.slice(),
  }, async () => ({
    metadata: emptyMetadata('认知神经论文'),
    pages: [{ page: 1, text: 'Attention improves memory and learning.' }], pageCount: 1,
  }));
  const completion = vi.fn().mockResolvedValue('注意力可以改善记忆。[S1]');
  const ai = new AiService(library, completion);
  if (configured) await ai.saveProvider({ name: '研究服务', baseUrl: 'https://api.example.com/v1', model: 'selected-model' }, 'session-key');
  const paper = await library.importPdf(new TextEncoder().encode('%PDF-1.7\nassistant fixture'), 'paper.pdf');
  return { library, ai, paper, completion };
}

function ask(question = '注意力的结论是什么？') {
  fireEvent.change(screen.getByLabelText('科研问题'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: '检索并提问' }));
}

beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });

describe('AI research assistant', () => {
  it('answers from the selected paper and opens a verified citation at its page', async () => {
    const { library, ai, paper } = await setup();
    const onOpenPaper = vi.fn();
    const askSpy = vi.spyOn(ai, 'ask');
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={onOpenPaper} />);
    expect(screen.getByLabelText('问答范围')).toHaveValue(paper.id);
    ask();
    await screen.findByText('注意力可以改善记忆。[S1]');
    expect(askSpy).toHaveBeenCalledWith('注意力的结论是什么？', [paper.id]);
    fireEvent.click(screen.getByRole('button', { name: /S1.*认知神经论文.*第 1 页/ }));
    expect(onOpenPaper).toHaveBeenCalledWith(paper.id, 1);
    ai.dispose();
  });

  it('guides users to settings before a provider and key are configured', async () => {
    const { library, ai } = await setup(false);
    const onOpenSettings = vi.fn();
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(/先配置 AI 厂商/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检索并提问' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '打开 AI 设置' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    ai.dispose();
  });

  it('renders model output as plain text and displays request errors', async () => {
    const { library, ai, completion } = await setup();
    completion.mockResolvedValueOnce('<img src=x onerror=alert(1)> [S1]');
    const { container } = render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    await screen.findByText('<img src=x onerror=alert(1)> [S1]');
    expect(container.querySelector('img')).toBeNull();
    completion.mockRejectedValueOnce(new Error('请求被限流，请稍后重试。'));
    ask('第二个问题');
    expect(await screen.findByRole('alert')).toHaveTextContent('限流');
    ai.dispose();
  });

  it('immediately clears the answer, question and locked selection when a folder locks', async () => {
    const { library, ai, paper } = await setup();
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('私密论文问题');
    await screen.findByText('注意力可以改善记忆。[S1]');
    await act(async () => { await library.lockVault(vault.id); });
    expect(screen.queryByText('注意力可以改善记忆。[S1]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    expect(screen.getByLabelText('问答范围')).toHaveValue('');
    expect(screen.queryByRole('button', { name: /S1/ })).not.toBeInTheDocument();
    ai.dispose();
  });

  it('ignores late results after cancellation even if the request ignores abort', async () => {
    const { library, ai, paper } = await setup();
    let finish: (answer: AiAnswer) => void = () => undefined;
    vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const cancel = vi.spyOn(ai, 'cancelAnswer');
    render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    expect(screen.getByRole('button', { name: '取消回答' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消回答' }));
    expect(cancel).toHaveBeenCalled();
    await act(async () => { finish({ text: '迟到的私密回答', sources: [{ label: 'S1', paperId: paper.id, page: 1, title: '论文', excerpt: '私密摘录' }], providerName: '研究服务' }); });
    expect(screen.queryByText('迟到的私密回答')).not.toBeInTheDocument();
    expect(screen.queryByText('私密摘录')).not.toBeInTheDocument();
    ai.dispose();
  });

  it('uses the answer epoch to discard a response after lock and unlock', async () => {
    const { library, ai, paper } = await setup();
    const folder = await library.createFolder('私密');
    await library.categorize([paper.id], [folder.id], 'move');
    const vault = await library.encryptFolder(folder.id, 'vault password');
    let finish: (answer: AiAnswer) => void = () => undefined;
    vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<AiAssistant library={library} ai={ai} initialPaperId={paper.id} onOpenPaper={vi.fn()} />);
    ask('保密问题');
    await act(async () => { await library.lockVault(vault.id); await library.unlockVault(vault.id, 'vault password'); });
    await act(async () => { finish({ text: '过期回答', sources: [], providerName: '研究服务' }); });
    expect(screen.queryByText('过期回答')).not.toBeInTheDocument();
    expect(screen.getByLabelText('科研问题')).toHaveValue('');
    ai.dispose();
  });

  it('cancels its outstanding request when unmounted', async () => {
    const { library, ai } = await setup();
    vi.spyOn(ai, 'ask').mockImplementationOnce(() => new Promise(() => undefined));
    const cancel = vi.spyOn(ai, 'cancelAnswer');
    const rendered = render(<AiAssistant library={library} ai={ai} onOpenPaper={vi.fn()} />);
    ask();
    await waitFor(() => expect(ai.ask).toHaveBeenCalled());
    rendered.unmount();
    expect(cancel).toHaveBeenCalledOnce();
    ai.dispose();
  });
});
