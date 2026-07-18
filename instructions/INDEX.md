# Documentation Index

**Portfolio Tracker Backend - Complete Documentation**  
**Last Updated:** 2026-07-18

---

## Quick Start

**For New Developers:**
1. Start here: [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)
2. Then read: [database-schema-current.md](./database-schema-current.md)
3. Reference: [endpoints-current.md](./endpoints-current.md)

**For Integration/API Usage:**
1. Read: [endpoints-current.md](./endpoints-current.md) - All endpoints with examples
2. Test: Run `npm test -- tests/17-large-scale.test.ts` to see it working

**For Database Design:**
1. Read: [database-schema-current.md](./database-schema-current.md) - Complete schema
2. Study: [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Architecture decisions

**For Testing:**
1. Read: [test-scenarios-current.md](./test-scenarios-current.md) - All 135 tests
2. Run: `npm test` to verify everything passes

---

## Documentation Files

### 1. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)
**Overview of the entire system** — Start here to understand the architecture.

**Sections:**
- Quick links to other docs
- Architecture overview (Display Lots vs Source Lots)
- Database schema summary
- API endpoints summary
- Test suite overview
- Key invariants and design decisions
- Getting started guide
- Support resources

**Best for:**
- Understanding the big picture
- Quick reference of how everything fits together
- Onboarding new developers

---

### 2. [database-schema-current.md](./database-schema-current.md)
**Complete database schema documentation** — Detailed reference for database design.

**Sections:**
- All core tables with columns, constraints, indexes
- Source lots tables (PurchaseLots, PurchaseLotAllocations)
- Display lots tables (DisplayLots, DisplayLotComposition, DisplayLotAllocations)
- Transaction tables (CashTransactions, StockTransactions, StockSplits)
- Audit tables (SplitAdjustments)
- Key design patterns
- Normalization and indexing strategy

**Best for:**
- Understanding database structure
- Writing SQL queries
- Database optimization
- Schema migration planning

---

### 3. [endpoints-current.md](./endpoints-current.md)
**Complete API endpoint documentation** — Reference for all REST endpoints.

**Sections:**
- Cash endpoints (GET, POST)
- Stock endpoints (GET, POST, DELETE)
- Purchase lot endpoints (GET)
- Display lot endpoints (GET, POST with combine/split)
- Error handling and status codes
- Authentication details
- Request/response examples

**Best for:**
- Frontend integration
- Testing API manually
- Understanding request/response format
- Error handling

---

### 4. [test-scenarios-current.md](./test-scenarios-current.md)
**Complete test suite documentation** — Detailed reference for all 135 tests.

**Sections:**
- Test files overview (17 files, 135 tests)
- Foundation tests (1-5): 34 tests on core workflows
- Display lots tests (6-16): 90 tests on display lot operations
- Large-scale tests (17): 10 tests on performance and scale
- Test helpers documentation
- Known issues and resolutions
- Coverage summary
- CI recommendations

**Best for:**
- Understanding what's tested
- Writing new tests
- Test-driven development
- Debugging test failures

---

### 5. [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md)
**Current vs original plan** — Tracks what's been completed.

**Sections:**
- Test coverage status matrix
- Feature implementation matrix (Phase 1-4)
- What's NOT implemented yet (frontend, analytics, etc.)
- Breaking changes from original plan
- Performance benchmarks
- Code quality metrics
- Production readiness checklist
- Next priority features
- Migration path

**Best for:**
- Project managers tracking progress
- Understanding what's left to do
- Migration planning
- Roadmap planning

---

## Navigation by Role

### Backend Developer
1. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Get oriented
2. [database-schema-current.md](./database-schema-current.md) - Understand the schema
3. [endpoints-current.md](./endpoints-current.md) - See what's available
4. [test-scenarios-current.md](./test-scenarios-current.md) - Understand tests

### Frontend Developer
1. [endpoints-current.md](./endpoints-current.md) - Learn the API
2. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Understand the data model
3. [test-scenarios-current.md](./test-scenarios-current.md) - See example requests/responses

### Database Administrator
1. [database-schema-current.md](./database-schema-current.md) - Complete schema reference
2. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Design decisions
3. [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md) - Performance benchmarks

### Product Manager
1. [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md) - What's done vs plan
2. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Feature overview
3. [test-scenarios-current.md](./test-scenarios-current.md) - Coverage summary

### QA / Tester
1. [test-scenarios-current.md](./test-scenarios-current.md) - All test cases
2. [endpoints-current.md](./endpoints-current.md) - API reference
3. [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md) - Architecture

---

## Quick Reference

### Database Statistics
- **Total Tables:** 9
- **Core Transaction Tables:** 3
- **Source Lot Tables:** 3
- **Display Lot Tables:** 3
- **Total Columns:** ~80
- **Total Indexes:** 25+

### API Statistics
- **Total Endpoints:** 23
- **Cash Endpoints:** 3
- **Stock Endpoints:** 6
- **Purchase Lot Endpoints:** 3
- **Display Lot Endpoints:** 11

### Test Statistics
- **Total Tests:** 135
- **Foundation Tests (1-5):** 34 cases
- **Display Lot Tests (6-16):** 90 cases
- **Large-Scale Tests (17):** 10 cases
- **Pass Rate:** 100%
- **Execution Time:** ~140 seconds

---

## Key Concepts

### Display Lots vs Purchase Lots
- **Purchase Lots:** Auto-created from transactions, immutable (except remainingQuantity)
- **Display Lots:** Manually created by users for portfolio organization
- **Invariant:** Sum of display lot shares = sum of purchase lot remaining shares

### Stock Splits
- Recorded with original ratio (e.g., "2-for-1")
- Retroactively adjusts quantities and prices
- Full audit trail preserved in SplitAdjustments table
- No rounding error accumulation (DECIMAL(18,8) precision)

### Smallest-First Consumption
- When sales are recorded, display lots are consumed in ascending quantity order
- Purchase lots can be consumed in any order (user-specified)
- Display lot consumption never affects underlying purchase lot history

### Cascade Deletes
- Deleting DisplayLots cascades to DisplayLotComposition
- Deleting StockTransactions cascades to allocations
- Deleting PurchaseLots does NOT cascade (prevents accidents)

---

## Common Tasks

### I want to...

**Understand the architecture**
→ Read [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)

**Add a new API endpoint**
→ Review [endpoints-current.md](./endpoints-current.md) for patterns, then check [database-schema-current.md](./database-schema-current.md) for available tables

**Write a new test**
→ Study [test-scenarios-current.md](./test-scenarios-current.md) for examples, check helpers in [setup.ts](../stock-tracker-backend/tests/setup.ts)

**Optimize database queries**
→ Review indexes in [database-schema-current.md](./database-schema-current.md), then benchmark with [test-scenarios-current.md](./test-scenarios-current.md) tests

**Integrate with frontend**
→ Start with [endpoints-current.md](./endpoints-current.md) for request/response format

**Plan next features**
→ Check [IMPLEMENTATION-STATUS.md](./IMPLEMENTATION-STATUS.md) for what's not done yet

---

## Files in This Directory

```
instructions/
├── IMPLEMENTATION-SUMMARY.md ........... 🎯 Architecture overview
├── database-schema-current.md ......... 🗄️ Database schema (complete)
├── endpoints-current.md .............. 🔌 API endpoints (complete)
├── test-scenarios-current.md ......... ✅ Test suite (all 135 tests)
├── IMPLEMENTATION-STATUS.md ........... 📊 Status vs original plan
├── INDEX.md (this file) .............. 📑 Documentation guide
├── database-schema.instructions.md ... 📝 Legacy/outdated
├── routes.instructions.md ............ 📝 Legacy/outdated
├── database-tests.instructions.md .... 📝 Legacy/outdated
├── front-end-functionality.instructions.md .. 📝 Legacy/outdated
└── backend-functionality.instructions.md .... 📝 Legacy/outdated
```

---

## Version History

| Date | Status | Key Changes |
|------|--------|-------------|
| 2026-07-18 | ✅ Complete | Fixed Test 17, created comprehensive documentation |
| 2026-07-17 | ⚠️ In Progress | Tests 1-16 passing, Test 17 timeout issues |
| 2026-07-12 | ⚠️ Partial | Display Lots schema added |
| 2026-07-01 | ⚠️ Initial | Foundation tests passing |

---

## Support & Questions

**For specific questions:**

- **Database design:** Check [database-schema-current.md](./database-schema-current.md)
- **API usage:** Check [endpoints-current.md](./endpoints-current.md)
- **Test examples:** Check [test-scenarios-current.md](./test-scenarios-current.md)
- **Architecture:** Check [IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)

**For issues:**
1. Search the relevant documentation file
2. Review test cases for similar scenarios
3. Check database schema constraints
4. Run tests to verify behavior

---

## Related Documentation

- **Main README:** [../README.md](../README.md)
- **Frontend Plan:** [../frontend-mvp-plan.md](../frontend-mvp-plan.md)
- **Project Description:** [../projectdescription.md](../projectdescription.md)
- **Test Scenarios (Original):** [../TEST_SCENARIOS.md](../TEST_SCENARIOS.md)

---

**Last Updated:** 2026-07-18  
**Maintenance:** Backend Team  
**Status:** ✅ All tests passing (135/135)
