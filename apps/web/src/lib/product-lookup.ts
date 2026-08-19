// Open Food Facts: a free, keyless, community-run product database
// (world.openfoodfacts.org) -- no API key, no meaningful rate limit for a
// single-lookup-per-scan use case. It signals a miss with status: 0 in the
// JSON body, not an HTTP 404, so that field is what actually has to be
// checked, not response.ok alone.
export async function lookupProductByBarcode(code: string): Promise<string | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // No network, DNS failure, etc. -- this app treats "offline" as a
    // normal mode, not an error state, so lookup failure here is silent.
    // Callers fall back to letting the person type the name themselves.
    return null;
  }
  if (!response.ok) return null;

  const data = (await response.json()) as { status?: number; product?: { product_name?: string } };
  if (data.status !== 1) return null;
  return data.product?.product_name?.trim() || null;
}
