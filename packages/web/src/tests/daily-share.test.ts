import { canShareFiles, fallbackPdfName, pdfFilename, sharePdf, type ShareEnv } from '@/components/daily/share';

const blob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
const input = { blob, filename: 'DR-0007-rev0.pdf', title: 'DR-0007' };

function env(nav: ShareEnv['navigator']) {
  const download = jest.fn();
  return { env: { navigator: nav, download } as ShareEnv, download };
}

describe('sharePdf — share sheet vs download fallback', () => {
  it('canShare false → downloads instead of sharing', async () => {
    const share = jest.fn();
    const { env: e, download } = env({ canShare: () => false, share });
    await expect(sharePdf(input, e)).resolves.toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(blob, 'DR-0007-rev0.pdf');
  });

  it('no Web Share API at all → downloads', async () => {
    const { env: e, download } = env({});
    await expect(sharePdf(input, e)).resolves.toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(1);
    const { env: e2, download: d2 } = env(null);
    await expect(sharePdf(input, e2)).resolves.toBe('downloaded');
    expect(d2).toHaveBeenCalledTimes(1);
  });

  it('canShare throwing is treated as unsupported', async () => {
    const { env: e, download } = env({ canShare: () => { throw new Error('x'); }, share: jest.fn() });
    await expect(sharePdf(input, e)).resolves.toBe('downloaded');
    expect(download).toHaveBeenCalled();
  });

  it('canShare true → navigator.share with the PDF file', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn().mockReturnValue(true);
    const { env: e, download } = env({ canShare, share });
    await expect(sharePdf(input, e)).resolves.toBe('shared');
    expect(download).not.toHaveBeenCalled();
    const arg = share.mock.calls[0][0] as { files: File[]; title: string };
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0].name).toBe('DR-0007-rev0.pdf');
    expect(arg.files[0].type).toBe('application/pdf');
    expect(arg.title).toBe('DR-0007');
    expect(canShare.mock.calls[0][0].files[0].name).toBe('DR-0007-rev0.pdf');
  });

  it('user closes the share sheet (AbortError) → cancelled, no surprise download', async () => {
    const share = jest.fn().mockRejectedValue(Object.assign(new Error('abort'), { name: 'AbortError' }));
    const { env: e, download } = env({ canShare: () => true, share });
    await expect(sharePdf(input, e)).resolves.toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('share refused without a recent tap (NotAllowedError) → retry', async () => {
    const share = jest.fn().mockRejectedValue(Object.assign(new Error('na'), { name: 'NotAllowedError' }));
    const { env: e, download } = env({ canShare: () => true, share });
    await expect(sharePdf(input, e)).resolves.toBe('retry');
    expect(download).not.toHaveBeenCalled();
  });

  it('any other share failure → download fallback', async () => {
    const share = jest.fn().mockRejectedValue(new TypeError('boom'));
    const { env: e, download } = env({ canShare: () => true, share });
    await expect(sharePdf(input, e)).resolves.toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('canShareFiles requires both share and canShare', () => {
    const f = new File([blob], 'a.pdf', { type: 'application/pdf' });
    expect(canShareFiles({ navigator: { canShare: () => true } }, f)).toBe(false);
    expect(canShareFiles({ navigator: { share: jest.fn() } }, f)).toBe(false);
    expect(canShareFiles({ navigator: { canShare: () => true, share: jest.fn() } }, f)).toBe(true);
  });
});

describe('pdfFilename', () => {
  it('reads Content-Disposition (plain and RFC 5987) and falls back', () => {
    expect(pdfFilename('attachment; filename="DR-0007-rev0.pdf"', 'x.pdf')).toBe('DR-0007-rev0.pdf');
    expect(pdfFilename("attachment; filename*=UTF-8''DR-0008-rev1.pdf", 'x.pdf')).toBe('DR-0008-rev1.pdf');
    expect(pdfFilename('attachment; filename="../../evil"', 'x.pdf')).toBe('....evil.pdf');
    expect(pdfFilename(null, fallbackPdfName('DR-0009', 2))).toBe('DR-0009-rev2.pdf');
    expect(pdfFilename('inline', 'DR-0001-rev0.pdf')).toBe('DR-0001-rev0.pdf');
  });
});
