/**
 * 1stOne F1 — print / PDF helper (web + native)
 *
 * Mirrors the web/native split used by exportCsv.ts.
 *   - Native: expo-print drives both paths — Print.printAsync to print, and
 *     Print.printToFileAsync + expo-sharing to "share as PDF".
 *   - Web:    expo-print's printToFileAsync and expo-sharing are unavailable
 *     (and printAsync is unreliable), so we render the HTML in a hidden iframe
 *     and call window.print(). The browser's print dialog lets the user send
 *     it to a printer OR pick "Save as PDF" — one path covers labels,
 *     summaries, and reports printed from a PC.
 *
 * Both modules are loaded with require() only on native so the web bundle
 * never pulls in the unsupported native code.
 */

import { Platform } from 'react-native';

/**
 * Print an HTML string in the browser via a throwaway hidden iframe.
 * Resolves once the print dialog has been triggered and the iframe cleaned up.
 */
function webPrintHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
    });
    document.body.appendChild(iframe);

    const win = iframe.contentWindow;
    const frameDoc = iframe.contentDocument || (win ? win.document : null);
    if (!win || !frameDoc) {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      resolve();
      return;
    }

    let triggered = false;
    const triggerPrint = () => {
      if (triggered) return;
      triggered = true;
      try {
        win.focus();
        win.print();
      } catch {
        /* user dismissed / blocked — nothing more to do */
      }
      // Leave the iframe in place briefly so the print dialog can grab it.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve();
      }, 1000);
    };

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    // Print once the iframe content has rendered; fall back to a short delay
    // for browsers that don't fire onload for document.write content.
    win.onload = () => setTimeout(triggerPrint, 200);
    setTimeout(triggerPrint, 700);
  });
}

/**
 * Print an HTML document.
 * Web → browser print dialog (print or Save as PDF). Native → expo-print.
 */
export async function printHtml(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    return webPrintHtml(html);
  }
  const Print = require('expo-print');
  await Print.printAsync({ html });
}

/**
 * Deliver an HTML document as a PDF.
 * Web → browser print dialog (the user chooses "Save as PDF"). Native →
 * render to a PDF file and open the OS share sheet.
 */
export async function sharePdf(html: string, dialogTitle = 'Document'): Promise<void> {
  if (Platform.OS === 'web') {
    return webPrintHtml(html);
  }
  const Print = require('expo-print');
  const Sharing = require('expo-sharing');
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    UTI: 'com.adobe.pdf',
    mimeType: 'application/pdf',
    dialogTitle,
  });
}
