/** A company's page, addressed by ticker: readable, and what people search for. */
export const companyPath = (ticker: string) => `/company/${encodeURIComponent(ticker)}`;
