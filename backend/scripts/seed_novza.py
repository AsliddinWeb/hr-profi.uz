"""Seed Novza-Eshiklari departments + employees + 9-18 shift.

Employee list is EMBEDDED below — no Excel file needed at runtime. Source
of truth is the "Апрель" sheet of the клиентнинг 2026 табел; if that
sheet changes, regenerate the EMPLOYEES list below.

Run inside the api container:

    python -m scripts.seed_novza                      # real seed
    python -m scripts.seed_novza --dry-run            # preview only
    python -m scripts.seed_novza --company novza-eshiklari --hire-date 2026-05-04

Optional flags:
    --company SLUG          (default: novza-eshiklari)
    --branch  NAME          (default: "Asosiy filial")
    --hire-date YYYY-MM-DD  (default: 2026-05-04)
    --prefix  STRING        (default: "novza_")
    --dry-run               do not write to DB

Idempotent on (company_id, full_name, department_id) — re-running won't
duplicate rows. New credentials are printed and saved to
``/tmp/novza_credentials.csv`` inside the container.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import re
import sys
from datetime import date, time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Role
from app.core.security import hash_password
from app.core.tenant import install_tenant_listener, set_current_tenant
from app.database import AsyncSessionLocal
from app.models.branch import Branch
from app.models.company import Company
from app.models.department import Department
from app.models.employee import Employee, SalaryType, WorkType
from app.models.shift import ShiftTemplate, ShiftType
from app.models.user import User, UserStatus

# ====================================================================
# EMBEDDED EMPLOYEE LIST
#
# Format: (department, full_name, position_or_None)
# Source: Novza табел 2026йил Апрель sheet, parsed once.
# Sections: Столярка / Малярка / ОФИС / Упакофка / Охрана.
# ====================================================================
EMPLOYEES: list[tuple[str, str, str | None]] = [
    ("Столярка", "Усмонов Рустам", "Началник"),
    ("Столярка", "Худойикулов Миржахон", "Бригадир"),
    ("Столярка", "Корабоев Санжарбек", "МТФ"),
    ("Столярка", "Авалов Шохрух", "Ровер аператор"),
    ("Столярка", "Досматов Мадамин", "Шпон"),
    ("Столярка", "Рахмонов Сардор", "Бригадир"),
    ("Столярка", "Зокиржонов Абдулазиз", "йордамчи"),
    ("Столярка", "Тургунов Фахриддин", "Абгонка"),
    ("Столярка", "Нийазходжаев Илхамходжа", "Абгонка"),
    ("Столярка", "Миразимов Фаррух", "Пресс"),
    ("Столярка", "Бозорова Рискижон", "До шкурка"),
    ("Столярка", "Махсудова Дилдора", "До заделка"),
    ("Столярка", "Хусанов Санжар", "Замокчи"),
    ("Столярка", "Турсунов Илхом", "Четверг"),
    ("Столярка", "Одилжонов Холмурод", "До мантаж"),
    ("Столярка", "Мирзамамудов Ғулом", "За делка/Отк"),
    ("Столярка", "Юсупов Абдуавахоб", "Погонаж"),
    ("Столярка", "Тоштургунов Жамшид", "Каробка"),
    ("Столярка", "Абдумаликов Сухроб", "карнез"),
    ("Столярка", "Рахимов Мирабзал", "Шкурка апарат"),
    ("Столярка", "Косимжонов Шовкат", "Каробка"),
    ("Столярка", "Турдиалийев Сардор", "Каробка"),
    ("Столярка", "Толқунов Даврон", "Ровер аператор"),
    ("Столярка", "Хасанов Елбек", "йордамчи"),
    ("Столярка", "Полвонов Азизбек", "Крой йордамчиси"),
    ("Столярка", "Султонов Ортиқбой", "Каробка"),
    ("Столярка", "Турдинов Фарход", "Замок"),
    ("Столярка", "Ботиров Фарход", None),
    ("Столярка", "Егамбердийев Давлат", "Карказ"),
    ("Столярка", "Ғапиров Сардор", "до мантаж"),
    ("Столярка", "Абдукосимов Гайрат", None),
    ("Столярка", "Каримов Шахзод", None),
    ("Столярка", "Кахрамонов Акмал", None),
    ("Малярка", "Абдуазимов Аброр", "Началник"),
    ("Малярка", "Жораев Дилмурод", "Бригадир"),
    ("Малярка", "Махмудов Тохир", "Бригадир"),
    ("Малярка", "Юлдошев Улугбек", "Бригадир"),
    ("Малярка", "Юлдошев Юнус", "Бригадир"),
    ("Малярка", "Кубеков Бекмурод", "краска"),
    ("Малярка", "Умаралийев Зиёвиддин", "краска"),
    ("Малярка", "Юнусхонов Бобур", "Краска"),
    ("Малярка", "Мадаминов Акром", "краска йордамчи"),
    ("Малярка", "Мирзайев Даврон", "краска йордамчи"),
    ("Малярка", "Шамсийев Хусниддин", "краска йордамчи"),
    ("Малярка", "Суннаттиллайев Азизбек", "краска йордамчи"),
    ("Малярка", "Акбаралийев Худойиберди", "Каробка"),
    ("Малярка", "Курбонкулов Отабек", "Каробка"),
    ("Малярка", "Гойназорова Хуршида", "Погоанаж шкурка"),
    ("Малярка", "Мажитова Нилуфар", "Погонаж шкурка"),
    ("Малярка", "Махкамбойева Мухлиса", "Погонаж шкурка"),
    ("Малярка", "Гуломова Махлиё", "Паганаж шкурка"),
    ("Малярка", "Тошканбойев Авазбек", "погонаж машинкачи"),
    ("Малярка", "Нишанбайева Дилдора", "шпаклофка паганаж"),
    ("Малярка", "Рахимов Бегзод", "Погонаж фора"),
    ("Малярка", "Тохиров Шохжахон", "Погонаж йордамчиси"),
    ("Малярка", "Абдукаримова Малика", "Эшик шкурка"),
    ("Малярка", "Рахимова Шахло", "Эшик шкурка"),
    ("Малярка", "Якубжонова Назокат", "Эшик шкурка"),
    ("Малярка", "Камолова Шахноза", "Эшик шкурка"),
    ("Малярка", "Кучкарова Шахноза", "Эшик шкурка"),
    ("Малярка", "Айнакулова Дилдора", "Эшик шкурка"),
    ("Малярка", "Рахимова Ибодат", "Эшик шкурка"),
    ("Малярка", "Рахимов Дилшод", "Шпаклофка ешик"),
    ("Малярка", "Султонов Умит", "Фора астар"),
    ("Малярка", "Маруфжонов Ойбек", "йордамчи"),
    ("Малярка", "Ергашев Нуриддин", "йордамчи"),
    ("Малярка", "Ражабойев Акмал", "Шпаклофка йордамчиси"),
    ("Малярка", "Атаджонова Рано", "шкуркачи"),
    ("Малярка", "Абдурашидова Фарида", "шкуркачи"),
    ("Малярка", "Қодирбердийева Сабрина", "шкуркачи"),
    ("Малярка", "Қодирбердийева Сафия", "шкуркачи"),
    ("Малярка", "Худойибердийев Сайдахмат", "йордамчи"),
    ("Малярка", "Саидахматов Худойберган", "йордамчи"),
    ("Малярка", "Бутунбайев Мухриддин", "йордамчи"),
    ("Малярка", "Махкамов Даврон", "йордамчи"),
    ("Малярка", "Турдикулов Бахром", "йордамчи"),
    ("Малярка", "Эгматов Ойбек", "йордамчи"),
    ("Малярка", "Норкулова Азиза", "шкуркачи"),
    ("Малярка", "Йолдошева Феруза", "йордамчи"),
    ("Малярка", "Жумайева Махлиё", "шкуркачи"),
    ("Малярка", "Хамидава Юлдуз", "шкуркачи"),
    ("Малярка", "Хасанова Мухаё", "шкуркачи"),
    ("Малярка", "Холматова Садоқат", "шкуркачи"),
    ("Малярка", "Ергашев Ойаттуллох", "мошинка"),
    ("Малярка", "Абдуллайев Азиз", "шкурка"),
    ("Малярка", "Собиржонова Дилдора", "шкурка"),
    ("Малярка", "Усмонова Барно", "шкурка"),
    ("ОФИС", "Ахмедов Донёр", "Зам директор"),
    ("ОФИС", "Жовлонов Аъзам", "Молия"),
    ("ОФИС", "Ергашев Отабек", "Бугалтер"),
    ("ОФИС", "Норматов Шухрат", "Проект менеджер"),
    ("ОФИС", "Алимов Марат", "Проект менеджер"),
    ("ОФИС", "Кучкарова Шахноза", "Секретар"),
    ("ОФИС", "Сайфутдинова Зарина", "Секретар"),
    ("ОФИС", "Комилов Жасур", "ошпаз"),
    ("ОФИС", "Мадаминова Севара", "ошпаз йордамчиси"),
    ("ОФИС", "Комилова Лазокат", "ошпаз йордамчиси"),
    ("ОФИС", "Шарапова Гулноза", "Техникчи"),
    ("ОФИС", "Мадаминов Жамшид", "ОТК"),
    ("ОФИС", "Суннаттилайев Отабек", "ОТК"),
    ("ОФИС", "Анорбойев Ахрор", "Зав,Склад"),
    ("ОФИС", "Рихсибойев Умиджон", "Склад"),
    ("ОФИС", "Хамидов Ахрор", "сваршик"),
    ("ОФИС", "Хасанбойев Мирзарахбар", "Склад"),
    ("ОФИС", "Маруфов Жалолиддин", "Склад"),
    ("Упакофка", "Ғанив Улуғбек", "Началник цеха"),
    ("Упакофка", "Зухриддинов Хусанжон", "Упаковка"),
    ("Упакофка", "Назиров Миразиз", "Упаковка"),
    ("Упакофка", "Турмахонов Ерлон", "Упакофка"),
    ("Упакофка", "Ерматов Бахром", "Шафйор"),
    ("Упакофка", "Исламбеков Умит", "Шафйор"),
    ("Упакофка", "Мирзаабдуллайев Хусниддин", "йордамчи"),
    ("Упакофка", "Нурмухаммедов Бобур", "йордамчи"),
    ("Охрана", "Бекмирзайв Фуркат", "Началник қоровил"),
    ("Охрана", "Кучкаров Ахмат", "Коровил"),
    ("Охрана", "Ахмедов Нурмат", "Коровил"),
    ("Охрана", "Қадиров Бахтиёр", "Коровул"),
]

# Cyrillic + Uzbek-Cyrillic specials → Latin. Lossy on purpose so a name
# with diacritics still produces a valid Latin login slug.
CYR_TO_LATIN: dict[str, str] = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e",
    "ё": "yo", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k",
    "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
    "э": "e", "ю": "yu", "я": "ya",
    # Uzbek-Cyrillic specials
    "ў": "o", "ғ": "g", "қ": "q", "ҳ": "h", "ҷ": "j", "ӣ": "i",
}


def translit(text: str) -> str:
    out: list[str] = []
    for ch in text.lower():
        out.append(CYR_TO_LATIN.get(ch, ch))
    return re.sub(r"[^a-z0-9]+", "", "".join(out))


def first_name(full: str) -> str:
    """Pick the second word as the given name. Common Uzbek convention is
    Surname Firstname [Middlename]."""
    parts = [p for p in full.strip().split() if p]
    if len(parts) >= 2:
        return translit(parts[1])
    return translit(parts[0]) if parts else ""


async def get_or_create_dept(
    db: AsyncSession, *, company_id, branch_id, name: str
) -> Department:
    existing = (
        await db.execute(
            select(Department).where(
                Department.company_id == company_id,
                Department.branch_id == branch_id,
                Department.name == name,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    d = Department(
        company_id=company_id,
        branch_id=branch_id,
        name=name,
        is_active=True,
    )
    db.add(d)
    await db.flush()
    return d


async def get_or_create_shift(
    db: AsyncSession, *, company_id
) -> ShiftTemplate:
    name = "9:00–18:00"
    existing = (
        await db.execute(
            select(ShiftTemplate).where(
                ShiftTemplate.company_id == company_id,
                ShiftTemplate.name == name,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    s = ShiftTemplate(
        company_id=company_id,
        name=name,
        type=ShiftType.FIXED.value,
        start_time=time(9, 0),
        end_time=time(18, 0),
        break_minutes=60,
        expected_hours=8.0,
        allow_overtime=True,
        is_active=True,
    )
    db.add(s)
    await db.flush()
    return s


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Seed Novza-Eshiklari employees from the embedded list.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--company", default="novza-eshiklari", help="Company slug")
    parser.add_argument("--branch", default="Asosiy filial", help="Branch name")
    parser.add_argument("--hire-date", default="2026-05-04", help="YYYY-MM-DD")
    parser.add_argument("--prefix", default="novza_", help="Login/password prefix")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    args = parser.parse_args(argv)

    hire_date = date.fromisoformat(args.hire_date)
    rows = EMPLOYEES
    dept_set = {r[0] for r in rows}
    print(f"📋 {len(rows)} employees across {len(dept_set)} departments (embedded)")
    for d in ["Столярка", "Малярка", "ОФИС", "Упакофка", "Охрана"]:
        n = sum(1 for r in rows if r[0] == d)
        if n:
            print(f"     • {d}: {n}")

    if args.dry_run:
        print("\n--- DRY RUN — first 10 ---")
        for d, n, p in rows[:10]:
            ism = first_name(n)
            login = f"{args.prefix}{ism}"
            print(f"  [{d:10s}] {n:38s} login={login}")
        return 0

    install_tenant_listener()

    async with AsyncSessionLocal() as db:
        company = (
            await db.execute(
                select(Company)
                .where(Company.slug == args.company)
                .execution_options(skip_tenant_filter=True)
            )
        ).scalar_one_or_none()
        if not company:
            print(
                f"❌ Company '{args.company}' not found. "
                f"Create it first via /owner/companies/new (slug={args.company}).",
                file=sys.stderr,
            )
            return 2
        print(f"🏢 Company: {company.name} (id={company.id})")
        set_current_tenant(company.id)

        branch = (
            await db.execute(
                select(Branch).where(
                    Branch.company_id == company.id,
                    Branch.name == args.branch,
                )
            )
        ).scalar_one_or_none()
        if not branch:
            branch = Branch(
                company_id=company.id,
                name=args.branch,
                is_active=True,
                geofence_radius_m=150,
            )
            db.add(branch)
            await db.flush()
        print(f"🏬 Branch:  {branch.name} (id={branch.id})")

        shift = await get_or_create_shift(db, company_id=company.id)
        print(f"⏰ Shift:   {shift.name}")

        existing_usernames: set[str] = set(
            (
                await db.execute(
                    select(User.username)
                    .where(User.company_id == company.id)
                    .execution_options(skip_tenant_filter=True)
                )
            ).scalars().all()
        )
        existing_codes = (
            await db.execute(
                select(Employee.employee_code).where(
                    Employee.company_id == company.id
                )
            )
        ).scalars().all()
        used_code_nums = {
            int(m.group(1))
            for code in existing_codes
            if (m := re.match(r"^NV(\d+)$", code or ""))
        }
        next_code = 1

        def next_emp_code() -> str:
            nonlocal next_code
            while next_code in used_code_nums:
                next_code += 1
            used_code_nums.add(next_code)
            code = f"NV{next_code:03d}"
            next_code += 1
            return code

        depts: dict[str, Department] = {}
        created: list[tuple[str, str, str, str, str]] = []
        skipped: list[str] = []

        for dept_name, full_name, position in rows:
            if dept_name not in depts:
                depts[dept_name] = await get_or_create_dept(
                    db,
                    company_id=company.id,
                    branch_id=branch.id,
                    name=dept_name,
                )
            dept = depts[dept_name]

            existing_emp = (
                await db.execute(
                    select(Employee).where(
                        Employee.company_id == company.id,
                        Employee.full_name == full_name,
                        Employee.department_id == dept.id,
                    )
                )
            ).scalar_one_or_none()
            if existing_emp:
                skipped.append(f"already exists in {dept_name}: {full_name}")
                continue

            ism = first_name(full_name)
            if not ism:
                skipped.append(f"empty first name: {full_name!r}")
                continue
            base = f"{args.prefix}{ism}"
            login = base
            i = 2
            while login in existing_usernames:
                login = f"{base}_{i}"
                i += 1
            existing_usernames.add(login)
            password = login

            user = User(
                company_id=company.id,
                username=login,
                email=None,
                password_hash=hash_password(password),
                role=Role.EMPLOYEE,
                status=UserStatus.ACTIVE,
                full_name=full_name,
                language="uz",
                is_active=True,
            )
            db.add(user)
            await db.flush()

            emp = Employee(
                company_id=company.id,
                branch_id=branch.id,
                department_id=dept.id,
                user_id=user.id,
                employee_code=next_emp_code(),
                full_name=full_name,
                position=position,
                hire_date=hire_date,
                work_type=WorkType.FIXED_SHIFT.value,
                shift_template_id=shift.id,
                salary_type=SalaryType.MONTHLY.value,
                is_active=True,
            )
            db.add(emp)
            await db.flush()

            created.append((dept_name, full_name, position or "", login, password))

        await db.commit()

        out_path = Path("/tmp/novza_credentials.csv")
        with out_path.open("w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["department", "full_name", "position", "login", "password"])
            for row in created:
                w.writerow(row)

        print()
        print(f"✓ {len(created)} employees created")
        if skipped:
            print(f"⊘ {len(skipped)} skipped:")
            for s in skipped[:10]:
                print(f"    {s}")
            if len(skipped) > 10:
                print(f"    … and {len(skipped) - 10} more")
        print()
        print(f"💾 Credentials saved → {out_path} (inside container)")
        print()
        print("FIRST 10 LOGINS (full list in CSV):")
        for d, fn, _pos, lg, pw in created[:10]:
            print(f"   {d:10s}  {fn:35s}  {lg:25s}  {pw}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
