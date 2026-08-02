# 0077 — Slice independence is read off the surface map's edges

Date: 2026-08-02
Status: accepted
Implemented-in: plugin/skills/_shared/bodies/plan.md
Reconciled: applied — Mode 1 phase 4 reads the graph off the surface map, with files overlap as the secondary check.
Source: this change (parallel wave execution); recorded with the change that made it

## Decision

Two slices are independent when no edge joins them, and the edges come from the surface map (§2), which carries four sources: a CONTRACT and its consumers, SHARED STATE two slices both write, a DATA FLOW running out of one into the other, and VERIFICATION-BAR COUPLING — two slices sharing no contract, no state, no data flow and no file that still cannot pass this project's bar apart. Files overlap is a SECONDARY check on top of the four, for physical conflicts only.

## Context

Verification-bar coupling is the edge none of the other three shows, and this repo is its own example: the linter binds every decision id a plugin file cites to that decision's `Implemented-in:` line, and the rule count spelled out in prose to the number of rule functions declared — so the slice that writes the citation and the slice that writes the decision file are one edge apart however disjoint their files read, and run side by side each tree is missing the other half and both go red. Files overlap is demoted because the Files field is expected touch points, declared rather than measured: an overlap it failed to predict is a merge conflict the integration gate reports (ADR-0084), never an edge the graph was trusted to have caught.
