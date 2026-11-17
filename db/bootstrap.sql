-- Run once as a Postgres superuser to create the database and its three logins.
-- Replace the passwords before running anywhere other than a developer machine.
CREATE ROLE ks_owner LOGIN PASSWORD 'change-me';
CREATE ROLE ks_app LOGIN PASSWORD 'change-me';
CREATE ROLE ks_commercial LOGIN PASSWORD 'change-me';
CREATE DATABASE ks_claims OWNER ks_owner;
