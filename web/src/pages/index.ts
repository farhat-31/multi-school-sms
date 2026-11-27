/** Pages are code-split: each area loads only when first opened. */
import { lazy } from "react";

const platform = () => import("./platform");
const people = () => import("./people");
const academics = () => import("./academics");
const finance = () => import("./finance");
const family = () => import("./family");

export const PlatformOverview = lazy(() => platform().then((m) => ({ default: m.PlatformOverview })));
export const SchoolsPage = lazy(() => platform().then((m) => ({ default: m.SchoolsPage })));
export const AdminPermissionsPage = lazy(() => platform().then((m) => ({ default: m.AdminPermissionsPage })));
export const CloudPage = lazy(() => platform().then((m) => ({ default: m.CloudPage })));

export const PeopleList = lazy(() => people().then((m) => ({ default: m.PeopleList })));
export const AddPeoplePage = lazy(() => people().then((m) => ({ default: m.AddPeoplePage })));
export const TeacherPermissionsPage = lazy(() => people().then((m) => ({ default: m.TeacherPermissionsPage })));

export const ClassesPage = lazy(() => academics().then((m) => ({ default: m.ClassesPage })));
export const TimetablePage = lazy(() => academics().then((m) => ({ default: m.TimetablePage })));
export const AttendancePage = lazy(() => academics().then((m) => ({ default: m.AttendancePage })));
export const ExamsPage = lazy(() => academics().then((m) => ({ default: m.ExamsPage })));
export const HomeworkPage = lazy(() => academics().then((m) => ({ default: m.HomeworkPage })));

export const FeesPage = lazy(() => finance().then((m) => ({ default: m.FeesPage })));
export const AnnouncementsPage = lazy(() => finance().then((m) => ({ default: m.AnnouncementsPage })));

export const SchoolOverview = lazy(() => import("./overview").then((m) => ({ default: m.SchoolOverview })));
export const SchoolSettingsPage = lazy(() => import("./settings").then((m) => ({ default: m.SchoolSettingsPage })));

export const MyOverview = lazy(() => family().then((m) => ({ default: m.MyOverview })));
export const MyAttendance = lazy(() => family().then((m) => ({ default: m.MyAttendance })));
export const MyResults = lazy(() => family().then((m) => ({ default: m.MyResults })));
export const MyFees = lazy(() => family().then((m) => ({ default: m.MyFees })));

export const AccountPage = lazy(() => import("./account").then((m) => ({ default: m.AccountPage })));
