export type BrandedNumber<Brand extends string> = number & {
    _brand: Brand;
}