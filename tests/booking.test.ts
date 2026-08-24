import {describe,it,expect} from 'vitest';
import {priceFor} from '../lib/booking';

describe('SeatForge pricing',()=>{
 it('selects category-specific prices',()=>{
  const e={premiumPrice:1200,standardPrice:800,vipPrice:1800};
  expect(priceFor('PREMIUM',e)).toBe(1200);
  expect(priceFor('STANDARD',e)).toBe(800);
  expect(priceFor('VIP',e)).toBe(1800);
 });
});
