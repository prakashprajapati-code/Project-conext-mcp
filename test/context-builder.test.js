import test from "node:test";
import assert from "node:assert/strict";

import {
  tokenize,
  stem,
  pathWords,
  scoreFiles,
  buildTaskContext
} from "../src/context/context-builder.js";

test("tokenize drops stopwords and low-signal words", () => {
  const keywords = tokenize("Add pagination to the brand products API");

  assert.ok(!keywords.includes("add"));
  assert.ok(!keywords.includes("the"));
  assert.ok(!keywords.includes("api"));
  assert.ok(keywords.includes("pagination"));
  assert.ok(keywords.includes("brand"));
  assert.ok(keywords.includes("products"));
});

test("stem collapses common plural and gerund forms", () => {
  assert.equal(stem("products"), "product");
  assert.equal(stem("categories"), "category");
  assert.equal(stem("orders"), "order");
  assert.equal(stem("pagination"), "pagination");
  assert.equal(stem("status"), "status");
  assert.equal(stem("auth"), "auth");
});

test("pathWords splits a path into normalized words", () => {
  const words = pathWords(
    "app/api/v1/modules/brand/repository/brand-product-assignment.repository.js"
  );

  assert.ok(words.includes("brand"));
  assert.ok(words.includes("product"));
  assert.ok(words.includes("repository"));
});

test("whole-word matching does not turn add into address", () => {
  const nodes = [
    "app/api/v1/common/models/brand-return-address.model.js",
    "app/api/v1/modules/brand/controller/brand.controller.js"
  ];

  const matches = scoreFiles(nodes, ["add", "brand"]);

  // "add" must never match "address"; the file can still match "brand".
  const addressMatch = matches.find(item =>
    item.file.includes("address")
  );

  if (addressMatch) {
    assert.ok(!addressMatch.matchedKeywords.includes("add"));
  }

  const addOnly = scoreFiles(
    ["app/api/v1/common/models/brand-return-address.model.js"],
    ["add"]
  );

  assert.equal(addOnly.length, 0);
});

test("plural task words match singular file names", () => {
  const nodes = [
    "app/api/v1/modules/product/repository/product.repository.js",
    "app/api/v1/modules/brand/routes/brand.route.js"
  ];

  const matches = scoreFiles(nodes, ["products"]);

  assert.equal(matches.length, 1);
  assert.equal(
    matches[0].file,
    "app/api/v1/modules/product/repository/product.repository.js"
  );
});

test("synonyms map authentication to auth files", () => {
  const nodes = [
    "app/api/v1/modules/auth/routes/auth.route.js",
    "app/api/v1/modules/brand/routes/brand.route.js"
  ];

  const matches = scoreFiles(nodes, ["authentication"]);

  assert.equal(matches.length, 1);
  assert.equal(
    matches[0].file,
    "app/api/v1/modules/auth/routes/auth.route.js"
  );
});

test("results are ranked by descending score", () => {
  const nodes = [
    "app/api/v1/modules/brand/helper.js",
    "app/api/v1/modules/brand/repository/brand-product.repository.js"
  ];

  const matches = scoreFiles(nodes, ["brand", "product"]);

  for (let index = 1; index < matches.length; index++) {
    assert.ok(matches[index - 1].score >= matches[index].score);
  }
});

test("buildTaskContext never returns an empty context", async () => {
  const result = await buildTaskContext("zzzz qqqq wwww");

  assert.equal(result.fallback, true);
  assert.ok(result.contextFiles.length > 0);
});
