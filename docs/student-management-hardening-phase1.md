# Student management hardening — phase 1

## Scope

Deze fase blijft bewust beperkt tot het bestaande student-domein:

- lifecycle/delete-policy expliciet maken
- identityKey/duplicate handling harden
- autorisatie en audit-compleetheid aanscherpen
- ontbrekende tests toevoegen
- docs syncen

Niet in scope:

- groups
- attendance
- scheduling
- andere nieuwe domeinen

## Lifecycle / delete policy

De huidige productpolicy in fase 1 is nu expliciet en leidend in code én docs:

- **hard delete voor studentrecords is uitgeschakeld**
- **deactivate/reactivate via `isActive` is het enige ondersteunde lifecycle-pad**
- **gedeactiveerde studentrecords blijven bestaan voor auditability en toekomstige referenties**
- **duplicate/identity uniqueness blijft ook gelden voor inactieve records**

Praktisch gevolg:

- deactiveren archiveert een student operationeel
- de student verdwijnt uit actieve tellingen en actieve level spread
- het record en auditspoor blijven bewaard
- een later nieuw record met dezelfde identityKey wordt geweigerd, ook als het oude record inactief is

## Identity key policy

De huidige identityKey blijft:

- genormaliseerde voornaam
- genormaliseerde achternaam
- geboortedatum (`YYYY-MM-DD`) wanneer bekend
- fallback `unknown-dob` wanneer geboortedatum ontbreekt

Dit betekent:

- zelfde naam + zelfde DOB => duplicate
- zelfde naam + andere DOB => toegestaan
- zelfde naam + beide zonder DOB => duplicate

## Audit expectations

Voor studentmutaties verwachten we nu minimaal:

- actor user
- actor membership / role
- student id
- identityKey waar relevant
- lifecycle policy flags waar relevant
- before/after snapshots bij updates

## Migration/backfill plan

Er is nog geen uitgevoerde Prisma-migratie in de repo. Voor bestaande shared omgevingen is het plan:

1. deploy code die identityKey blijft schrijven op alle create/update flows
2. backfill bestaande studentrecords met dezelfde normalisatieregel
3. detecteer en resolve collision-cases vóór het toevoegen of valideren van de uniqueness-constraint in productie
4. draai daarna pas de definitieve DB-migratie/constraint-assertie in shared environments

Zie ook `docs/student-identity-migration-plan.sql`.
