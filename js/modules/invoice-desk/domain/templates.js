export const TEMPLATES = Object.freeze({
  'bs-mart': Object.freeze({
    id: 'bs-mart-v1',
    version: 1,
    worksheet: 'BS Mart (6)',
    amountWords: true,
    discount: false,
    paymentFields: ['cash', 'change'],
  }),
  'safari-book-land': Object.freeze({
    id: 'safari-book-land-v1',
    version: 1,
    worksheet: 'Safari Book Land (2)',
    amountWords: false,
    discount: false,
    paymentFields: ['cash', 'change'],
  }),
  'best-choice-store': Object.freeze({
    id: 'best-choice-store-v1',
    version: 1,
    worksheet: 'Best Choice Store',
    amountWords: false,
    discount: true,
    paymentFields: [],
  }),
});
export function templateForBusiness(businessId) {
  const template = TEMPLATES[businessId];
  if (!template) throw new Error('Unknown invoice business.');
  return template;
}
