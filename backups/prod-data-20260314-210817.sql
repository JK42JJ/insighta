--
-- PostgreSQL database dump
--

\restrict OPtJP1NJMrDczZHwwVgVE88eY7BeEE81RdB7SajGLqwCn2UuDP1F0NHqbDjPjuO

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: user_mandalas; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_mandalas (id, user_id, title, is_default, "position", created_at, updated_at, is_public, share_slug) FROM stdin;
aa7af62b-c8c2-4d2a-964a-d4a5ee788700	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	2026년 목표	t	0	2026-03-11 03:05:57.707+00	2026-03-11 03:05:57.707+00	f	\N
4bb28086-7705-4523-9b9d-d28303fa7e54	190605aa-8e78-45b6-8291-12a156ff17da	취업 성공	f	0	2026-03-10 00:25:56.388+00	2026-03-12 05:55:41.399+00	f	\N
d503f4a0-32a6-43d2-a991-12d96592115b	190605aa-8e78-45b6-8291-12a156ff17da	2026년 목표	t	1	2026-03-10 00:52:51.092+00	2026-03-12 05:55:58.666+00	t	AbSZuYf0mKXe
49763883-e295-4ea9-abec-ae7cea08d5a0	0192fedf-85f4-47ab-a652-7fdd116e2b39	영향력 있는 크리에이터	t	0	2026-03-09 17:57:37.619+00	2026-03-12 14:46:47.402+00	t	KnTIiSVyAKR9
8514498d-9292-489d-8cd0-797a7d111976	af12c5e9-2399-4e92-869c-d31d916cce44	AI/ML Expert	t	0	2026-03-13 07:02:22.975+00	2026-03-13 07:02:22.975+00	f	\N
\.


--
-- Data for Name: content_entities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content_entities (id, user_id, source_type, title, source_url, source_id, thumbnail, notes, tags, metadata, cell_index, level_id, mandala_id, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: credentials; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credentials (id, data, created_at, updated_at, user_id) FROM stdin;
\.


--
-- Data for Name: mandala_activity_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.mandala_activity_log (id, mandala_id, user_id, action, entity_type, entity_id, metadata, created_at) FROM stdin;
9015cae9-f752-44cf-a751-b6c4b864ae19	4bb28086-7705-4523-9b9d-d28303fa7e54	190605aa-8e78-45b6-8291-12a156ff17da	share_enabled	mandala	\N	\N	2026-03-10 00:53:02.111+00
dcf86867-d5d1-4cb0-baee-3ba349ee4758	4bb28086-7705-4523-9b9d-d28303fa7e54	190605aa-8e78-45b6-8291-12a156ff17da	share_enabled	mandala	\N	\N	2026-03-10 00:53:03.162+00
23ceca41-6813-4a23-8773-532d4a0288fd	4bb28086-7705-4523-9b9d-d28303fa7e54	190605aa-8e78-45b6-8291-12a156ff17da	share_disabled	mandala	\N	\N	2026-03-10 00:53:11.733+00
b56e799b-e0bb-4b92-9b62-7a5c5961f315	4bb28086-7705-4523-9b9d-d28303fa7e54	190605aa-8e78-45b6-8291-12a156ff17da	share_disabled	mandala	\N	\N	2026-03-10 00:53:12.036+00
8303f00d-89a0-4fef-a75a-e25d44db263c	d503f4a0-32a6-43d2-a991-12d96592115b	190605aa-8e78-45b6-8291-12a156ff17da	share_enabled	mandala	\N	\N	2026-03-10 01:19:00.202+00
bb8211b4-829c-4b28-858f-606a8be053b5	49763883-e295-4ea9-abec-ae7cea08d5a0	0192fedf-85f4-47ab-a652-7fdd116e2b39	share_enabled	mandala	\N	\N	2026-03-12 14:46:47.423+00
\.


--
-- Data for Name: mandala_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.mandala_subscriptions (id, subscriber_id, mandala_id, subscribed_at) FROM stdin;
\.


--
-- Data for Name: quota_usage; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.quota_usage (id, date, used, quota_limit, created_at, updated_at) FROM stdin;
721db2de-1776-4fde-88e2-678fa27872b0	2026-03-06 00:00:00+00	20	10000	2026-03-06 06:38:46.207+00	2026-03-06 06:38:46.207+00
ecc56936-b9dc-4dd4-b827-70e9f95391a4	2026-03-07 00:00:00+00	5	10000	2026-03-07 02:45:52.737+00	2026-03-07 02:45:52.737+00
a58f023e-061b-4d14-bccc-8578c71d5273	2026-03-08 00:00:00+00	1	10000	2026-03-08 11:12:04.109+00	2026-03-08 11:12:04.109+00
6f2fa855-fb36-4c8b-8c0f-dedd9411682f	2026-03-10 00:00:00+00	3	10000	2026-03-10 00:31:31.973+00	2026-03-10 00:31:31.973+00
6debbe26-0688-4605-a45a-62c5b7b545af	2026-03-11 00:00:00+00	4	10000	2026-03-11 06:33:42.135+00	2026-03-11 06:33:42.135+00
c7c6975e-1165-453a-982a-7bc5e90d6277	2026-03-12 00:00:00+00	6	10000	2026-03-12 00:09:59.787+00	2026-03-12 00:09:59.787+00
\.


--
-- Data for Name: quota_operations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.quota_operations (id, quota_usage_id, operation_type, cost, "timestamp") FROM stdin;
af9344b6-5c3b-44ac-a737-cb1f529b51eb	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 06:38:46.225+00
8cc886fb-c483-45ca-8002-78c9392a775d	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 06:44:07.312+00
a3616f90-e0f5-4c65-beb1-32f510300345	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 08:02:15.344+00
95a2a3a9-2d89-4c8a-b668-600078537e11	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 08:15:41.536+00
a676df2a-4b20-47da-aa38-3963efd050e8	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 08:21:45.791+00
740c9459-39d3-4224-995a-23742acb5d20	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 08:23:40.583+00
b3ae2e9b-aaf5-4c0d-b89c-f474adc63d18	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 08:26:22.666+00
a89a3c02-1b0d-4978-b10f-33ecb7dbdb59	721db2de-1776-4fde-88e2-678fa27872b0	playlist.details	1	2026-03-06 08:39:39.273+00
a21a1f54-64ee-4054-b0c4-d03ce0eb4bb8	721db2de-1776-4fde-88e2-678fa27872b0	playlist.items	1	2026-03-06 08:41:27.733+00
b8ddc6d0-7596-4ac0-85a4-823835c7b13b	721db2de-1776-4fde-88e2-678fa27872b0	video.details	1	2026-03-06 08:41:27.918+00
730e0107-72e3-4ec2-a672-fe8c81d14b10	721db2de-1776-4fde-88e2-678fa27872b0	playlist.items	1	2026-03-06 09:30:35.239+00
7422ace8-995d-4b1c-bc3a-156a77dc0063	721db2de-1776-4fde-88e2-678fa27872b0	video.details	1	2026-03-06 09:30:35.422+00
16a131c7-493a-47fa-8271-2f9ffb626f05	721db2de-1776-4fde-88e2-678fa27872b0	playlist.items	1	2026-03-06 09:30:53.406+00
119ff7df-42ee-4a48-9b0f-09a1c552f04a	721db2de-1776-4fde-88e2-678fa27872b0	video.details	1	2026-03-06 09:30:53.442+00
b4f92865-45df-49c0-bcb7-9d9ce02cd593	721db2de-1776-4fde-88e2-678fa27872b0	playlist.items	1	2026-03-06 09:51:54.031+00
ca54d556-4cf0-4f61-aa86-e66241b2f265	721db2de-1776-4fde-88e2-678fa27872b0	video.details	1	2026-03-06 09:51:54.087+00
da16f0e9-c7b3-4e32-b529-db8edd9b5319	721db2de-1776-4fde-88e2-678fa27872b0	playlist.items	1	2026-03-06 09:52:19.41+00
05d64c2a-b975-43f5-b09f-9d8e19f67541	721db2de-1776-4fde-88e2-678fa27872b0	video.details	1	2026-03-06 09:52:19.447+00
6ea2c67e-84a7-4f0d-b519-8119497f882d	721db2de-1776-4fde-88e2-678fa27872b0	playlist.items	1	2026-03-06 09:55:40.316+00
b0731976-1d49-401b-bf18-1d6b0a83a0f7	721db2de-1776-4fde-88e2-678fa27872b0	video.details	1	2026-03-06 09:55:40.359+00
becb7a07-7665-4ffa-8572-26658d44a053	ecc56936-b9dc-4dd4-b827-70e9f95391a4	playlist.items	1	2026-03-07 02:45:52.743+00
1e21af9a-76ca-4ba4-9f8a-1fa52a413981	ecc56936-b9dc-4dd4-b827-70e9f95391a4	playlist.items	1	2026-03-07 02:45:54.057+00
62a65970-027f-4fff-a316-1f93a50afadf	ecc56936-b9dc-4dd4-b827-70e9f95391a4	playlist.items	1	2026-03-07 02:45:56.332+00
0e9521c5-0701-4c75-9860-55d0c42c780f	ecc56936-b9dc-4dd4-b827-70e9f95391a4	playlist.items	1	2026-03-07 02:46:01.296+00
dd255ee5-7c03-4dc0-a7c0-1c86f97a7642	ecc56936-b9dc-4dd4-b827-70e9f95391a4	playlist.items	1	2026-03-07 02:46:11.529+00
6b458def-0cd3-439f-92b1-3e527ef0158d	a58f023e-061b-4d14-bccc-8578c71d5273	playlist.details	1	2026-03-08 11:12:04.129+00
9071cc95-f664-42c0-80db-da8160b9cf29	6f2fa855-fb36-4c8b-8c0f-dedd9411682f	playlist.details	1	2026-03-10 00:31:31.993+00
1fa78147-808c-4099-924e-8b3dcf892f02	6f2fa855-fb36-4c8b-8c0f-dedd9411682f	playlist.details	1	2026-03-10 00:31:33.765+00
e6b43ac8-0920-4f0d-9059-0b74237cf822	6f2fa855-fb36-4c8b-8c0f-dedd9411682f	playlist.details	1	2026-03-10 00:31:59.506+00
82fbd5ab-fb32-452d-b477-7288f2961eeb	6debbe26-0688-4605-a45a-62c5b7b545af	playlist.items	1	2026-03-11 06:33:42.146+00
2070bf63-92d8-4a01-b877-6aa6d0a409a4	6debbe26-0688-4605-a45a-62c5b7b545af	video.details	1	2026-03-11 06:33:42.486+00
8133b0a5-af1e-4abd-943c-3d22c84cc32f	6debbe26-0688-4605-a45a-62c5b7b545af	playlist.items	1	2026-03-11 07:10:44.471+00
12a151ac-368c-4b12-abae-091bc8b5f1ad	6debbe26-0688-4605-a45a-62c5b7b545af	video.details	1	2026-03-11 07:10:44.747+00
27d77c6c-4e35-4a08-9483-0508e072a3a6	c7c6975e-1165-453a-982a-7bc5e90d6277	playlist.items	1	2026-03-12 00:09:59.793+00
9c2088d1-561b-400a-852b-5c33a85e98ae	c7c6975e-1165-453a-982a-7bc5e90d6277	video.details	1	2026-03-12 00:09:59.996+00
f95ace40-8824-4c02-b7fc-479af0d09356	c7c6975e-1165-453a-982a-7bc5e90d6277	playlist.items	1	2026-03-12 00:10:06.369+00
b0876419-212f-46f5-817a-3dbf6dce9195	c7c6975e-1165-453a-982a-7bc5e90d6277	video.details	1	2026-03-12 00:10:06.406+00
630e2a58-3cbb-49b5-bceb-a538025a20fc	c7c6975e-1165-453a-982a-7bc5e90d6277	playlist.items	1	2026-03-12 00:10:09.111+00
27c819b9-d59e-4580-b8f9-9528a12122bd	c7c6975e-1165-453a-982a-7bc5e90d6277	video.details	1	2026-03-12 00:10:09.146+00
\.


--
-- Data for Name: youtube_playlists; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.youtube_playlists (id, user_id, youtube_playlist_id, youtube_playlist_url, title, description, thumbnail_url, channel_title, item_count, last_synced_at, sync_status, sync_error, created_at, updated_at) FROM stdin;
f303e57f-c75b-4406-906a-6f90f99c837d	0192fedf-85f4-47ab-a652-7fdd116e2b39	PLF-MpOTIl9JFtsldoGfwUive9ZjqZKcXK	https://www.youtube.com/playlist?list=PLF-MpOTIl9JFtsldoGfwUive9ZjqZKcXK	LLM 갈구기		https://i.ytimg.com/vi/knwG2f0FHDw/default.jpg	Brian9	23	2026-03-12 00:10:09.581+00	completed	\N	2026-03-06 08:39:39.303+00	2026-03-06 08:39:39.303+00
\.


--
-- Data for Name: sync_schedules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sync_schedules (id, playlist_id, interval_ms, enabled, last_run, next_run, retry_count, max_retries, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_local_cards; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_local_cards (id, user_id, url, title, thumbnail, link_type, user_note, metadata_title, metadata_description, metadata_image, cell_index, level_id, sort_order, created_at, updated_at, mandala_id) FROM stdin;
249fb6bd-12ca-400d-a90f-f145db66aec7	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	https://www.youtube.com/watch?v=LPZh9BOjkQs	Large Language Models explained briefly	https://img.youtube.com/vi/LPZh9BOjkQs/mqdefault.jpg	youtube		\N	\N	\N	-1	scratchpad	\N	2026-03-06 01:12:20.598743+00	2026-03-06 01:12:20.598743+00	aa7af62b-c8c2-4d2a-964a-d4a5ee788700
09ce87fe-42ba-44bf-bc3d-5abccb1121d4	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	https://www.youtube.com/watch?v=wrguEHxk_EI	뉴럴네트워크라는걸 들어 보셨다면 보셔야 할 영상. - DL1	https://img.youtube.com/vi/wrguEHxk_EI/mqdefault.jpg	youtube		\N	\N	\N	4	root	\N	2026-03-06 01:14:46.693586+00	2026-03-06 01:14:46.693586+00	aa7af62b-c8c2-4d2a-964a-d4a5ee788700
8cc65093-69a6-4cec-98aa-4433b0312a61	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	https://www.youtube.com/watch?v=uzH78u0TmwQ&list=RDuzH78u0TmwQ&start_radio=1&pp=oAcB	[𝑪𝑪𝑴 𝑷𝒊𝒂𝒏𝒐 𝑷𝒍𝒂𝒚𝒍𝒊𝒔𝒕]  여호와께서 너의 걸음을 정하시고	https://img.youtube.com/vi/uzH78u0TmwQ/mqdefault.jpg	youtube		\N	\N	\N	2	root	\N	2026-03-06 01:00:34.764822+00	2026-03-06 01:00:34.764822+00	aa7af62b-c8c2-4d2a-964a-d4a5ee788700
cf9e8c7e-6def-4968-ac3a-52f289baacb7	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	https://www.youtube.com/watch?v=p09i_hoFdd0&t=596s	ASMR Programming - Spinning Cube - No Talking	https://img.youtube.com/vi/p09i_hoFdd0/mqdefault.jpg	youtube	[11:51](https://www.youtube.com/watch?v=p09i_hoFdd0&t=711s) 	\N	\N	\N	4	root	\N	2026-03-06 00:59:36.864148+00	2026-03-06 00:59:36.864148+00	aa7af62b-c8c2-4d2a-964a-d4a5ee788700
c7506316-dee5-420a-a430-f62309b76fe0	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	https://www.youtube.com/watch?v=oqoozPw5tgM&list=RDoqoozPw5tgM&start_radio=1&pp=oAcB	Alone With God 🤍 Soaking worship | Prayer and Devotional Instrumental Piano	https://img.youtube.com/vi/oqoozPw5tgM/mqdefault.jpg	youtube		\N	\N	\N	5	root	\N	2026-03-06 01:00:46.153989+00	2026-03-06 01:00:46.153989+00	aa7af62b-c8c2-4d2a-964a-d4a5ee788700
0027cc39-41ac-47a7-ae4d-bd190f4a8837	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	https://www.youtube.com/watch?v=RibBuB0zVNA&pp=ugUHEgVlbi1VUw%3D%3D	Simulating 3 Body Problem In C++	https://img.youtube.com/vi/RibBuB0zVNA/mqdefault.jpg	youtube		\N	\N	\N	-1	scratchpad	\N	2026-03-06 01:00:28.3961+00	2026-03-06 01:00:28.3961+00	aa7af62b-c8c2-4d2a-964a-d4a5ee788700
1eeea1c2-0ae4-4e8a-8d60-9750ab3ff206	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=2QQQtiFwXjU&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=1&pp=iAQB	Intro to UX (User Experience) | Google UX Design Certificate	https://img.youtube.com/vi/2QQQtiFwXjU/mqdefault.jpg	youtube	사용자 경험: 무언가를 더 쉽게	\N	\N	\N	6	root	\N	2026-03-10 00:34:55.568786+00	2026-03-10 00:34:55.568786+00	4bb28086-7705-4523-9b9d-d28303fa7e54
6a72ea7c-4ace-46e9-9643-95143128533e	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=CDo4dPywm4o&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=2&pp=iAQB	UX Design Careers | Google UX Design Certificate	https://img.youtube.com/vi/CDo4dPywm4o/mqdefault.jpg	youtube	designer 인턴쉽	\N	\N	\N	0	멘탈관리	\N	2026-03-10 00:34:57.341033+00	2026-03-10 00:34:57.341033+00	4bb28086-7705-4523-9b9d-d28303fa7e54
6d8d1713-1a47-48ca-acdc-708c63b20d6a	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=PdQz27oq_uE&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=6&pp=iAQB	How Psychology Affects Design | Google UX Design Certificate	https://img.youtube.com/vi/PdQz27oq_uE/mqdefault.jpg	youtube		\N	\N	\N	0	재테크	\N	2026-03-10 00:35:10.027533+00	2026-03-10 00:35:10.027533+00	4bb28086-7705-4523-9b9d-d28303fa7e54
93d8f7b0-d37c-4c8d-b1d0-5b56528fdec6	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=BIGx2ohbCY4&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=5&pp=iAQB	Build a Website Design Portfolio | Google UX Design Certificate	https://img.youtube.com/vi/BIGx2ohbCY4/mqdefault.jpg	youtube	웹사이트 디자인 포트폴리오: 채용담당자에게 웹사이트 디자인 능력을 보여주는 작품	\N	\N	\N	2	root	\N	2026-03-10 00:35:07.593881+00	2026-03-10 00:35:07.593881+00	4bb28086-7705-4523-9b9d-d28303fa7e54
470e8e3a-5908-4a2b-9759-28591fed268a	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=_PFqcMh7Uqk&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=4&pp=iAQB	UX Design: Tools, Terms, & Platforms You Need | Google UX Design Certificate	https://img.youtube.com/vi/_PFqcMh7Uqk/mqdefault.jpg	youtube	형평성에 맞춘 디자인의 초점은 공정한 긍정적 목표를 달성하기 위한 디자인	\N	\N	\N	5	root	\N	2026-03-10 00:35:03.348422+00	2026-03-10 00:35:03.348422+00	4bb28086-7705-4523-9b9d-d28303fa7e54
549c462b-1054-4263-be44-ebbe5b01401d	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=s1VAh51C9Bo&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=9&pp=iAQB	The Design Thinking Process | Google UX Design Certificate	https://img.youtube.com/vi/s1VAh51C9Bo/mqdefault.jpg	youtube	idea 생성 구상 , 많은 아이디어를 떠 올리는 것	\N	\N	\N	0	root	\N	2026-03-10 00:35:28.96559+00	2026-03-10 00:35:28.96559+00	4bb28086-7705-4523-9b9d-d28303fa7e54
29c172e7-4d83-40ba-b48b-20c4acd98678	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=kQ_6faxhyIw&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=7&pp=iAQB0gcJCcUKAYcqIYzv	What is UX Research? | Google UX Design Certificate	https://img.youtube.com/vi/kQ_6faxhyIw/mqdefault.jpg	youtube	디자이너의 역할:  사용자의 경험 개선	\N	\N	\N	1	root	\N	2026-03-10 00:35:12.22465+00	2026-03-10 00:35:12.22465+00	4bb28086-7705-4523-9b9d-d28303fa7e54
e189210f-f2d7-495e-97e4-fe029f3fafe2	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=fqNAWyOOVfw&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=8&pp=iAQB	The Importance of Empathy in UX Design | Google UX Design Certificate	https://img.youtube.com/vi/fqNAWyOOVfw/mqdefault.jpg	youtube	공감이란 동정이나 연민과 비슷하지만 늬앙스가 다르다. 정신적 감정적 경험을 함께 하는 것. 공감시각화 : 공감지도\n	\N	\N	\N	3	root	\N	2026-03-10 00:35:17.027852+00	2026-03-10 00:35:17.027852+00	4bb28086-7705-4523-9b9d-d28303fa7e54
c49ec807-120a-4dc0-8f55-c10aa478c56e	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=xVvVaIWTuck&list=PLTZYG7bZ1u6oHnGp4Ib3n0y-CmFQdTW6r&index=3&pp=iAQB	What is a Design Sprint? | Google UX Design Certificate	https://img.youtube.com/vi/xVvVaIWTuck/mqdefault.jpg	youtube	인체공학적 설계 - 디자인 스프린트 활용	\N	\N	\N	6	root	\N	2026-03-10 00:34:59.568423+00	2026-03-10 00:34:59.568423+00	4bb28086-7705-4523-9b9d-d28303fa7e54
623686c2-a7a2-4b30-b6df-da3615e4c4d6	190605aa-8e78-45b6-8291-12a156ff17da	https://www.youtube.com/watch?v=6YB318tbLNA&list=PLkbzizJk4Ae815Tj0A8eZMtJSttcNa-Od&index=4&pp=iAQB0gcJCcUKAYcqIYzv	앱과 웹의 다른 점 - UXUI 디자인 강좌 1-4	https://img.youtube.com/vi/6YB318tbLNA/mqdefault.jpg	youtube	web과 app의 다른 점	\N	\N	\N	4	root	\N	2026-03-10 01:13:19.768249+00	2026-03-10 01:13:19.768249+00	\N
\.


--
-- Data for Name: user_mandala_levels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_mandala_levels (id, mandala_id, parent_level_id, level_key, center_goal, subjects, "position", depth, color, created_at, updated_at) FROM stdin;
28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	49763883-e295-4ea9-abec-ae7cea08d5a0	\N	root	영향력 있는 크리에이터	{"콘텐츠 기획",촬영/편집,"채널 브랜딩",커뮤니티,수익화,협업/협찬,"트렌드 분석",자기관리}	0	0	\N	2026-03-09 17:57:37.655+00	2026-03-09 17:57:37.655+00
1dee550a-fe3c-4d33-b244-e5c9cfba5b90	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	콘텐츠기획	콘텐츠 기획	{"콘텐츠 기획 1","콘텐츠 기획 2","콘텐츠 기획 3","콘텐츠 기획 4","콘텐츠 기획 5","콘텐츠 기획 6","콘텐츠 기획 7","콘텐츠 기획 8"}	0	1	\N	2026-03-09 17:57:37.695+00	2026-03-09 17:57:37.695+00
242428f7-ffdf-4f58-a31a-6b6094d78656	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	촬영/편집	촬영/편집	{"촬영/편집 1","촬영/편집 2","촬영/편집 3","촬영/편집 4","촬영/편집 5","촬영/편집 6","촬영/편집 7","촬영/편집 8"}	1	1	\N	2026-03-09 17:57:37.707+00	2026-03-09 17:57:37.707+00
f5348db1-e21e-4702-9776-22571c960e01	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	채널브랜딩	채널 브랜딩	{"채널 브랜딩 1","채널 브랜딩 2","채널 브랜딩 3","채널 브랜딩 4","채널 브랜딩 5","채널 브랜딩 6","채널 브랜딩 7","채널 브랜딩 8"}	2	1	\N	2026-03-09 17:57:37.714+00	2026-03-09 17:57:37.714+00
847ed05c-e516-448e-a17f-9ca74e924780	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	커뮤니티	커뮤니티	{"커뮤니티 1","커뮤니티 2","커뮤니티 3","커뮤니티 4","커뮤니티 5","커뮤니티 6","커뮤니티 7","커뮤니티 8"}	3	1	\N	2026-03-09 17:57:37.722+00	2026-03-09 17:57:37.722+00
118fc4cc-35d3-4c56-846d-1052511fea95	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	수익화	수익화	{"수익화 1","수익화 2","수익화 3","수익화 4","수익화 5","수익화 6","수익화 7","수익화 8"}	4	1	\N	2026-03-09 17:57:37.731+00	2026-03-09 17:57:37.731+00
0e4780f2-d085-4572-881d-d73a76257064	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	협업/협찬	협업/협찬	{"협업/협찬 1","협업/협찬 2","협업/협찬 3","협업/협찬 4","협업/협찬 5","협업/협찬 6","협업/협찬 7","협업/협찬 8"}	5	1	\N	2026-03-09 17:57:37.738+00	2026-03-09 17:57:37.738+00
c3165e4f-c430-4e86-8a09-1cd10d2a08e7	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	트렌드분석	트렌드 분석	{"트렌드 분석 1","트렌드 분석 2","트렌드 분석 3","트렌드 분석 4","트렌드 분석 5","트렌드 분석 6","트렌드 분석 7","트렌드 분석 8"}	6	1	\N	2026-03-09 17:57:37.747+00	2026-03-09 17:57:37.747+00
f1216adc-1891-44a7-8bce-4eddefb35999	49763883-e295-4ea9-abec-ae7cea08d5a0	28722f3f-dd3d-4cfc-81eb-b8d9a5ab90bd	자기관리	자기관리	{"자기관리 1","자기관리 2","자기관리 3","자기관리 4","자기관리 5","자기관리 6","자기관리 7","자기관리 8"}	7	1	\N	2026-03-09 17:57:37.76+00	2026-03-09 17:57:37.76+00
10f3a669-4407-430d-ac29-7b77478b0989	4bb28086-7705-4523-9b9d-d28303fa7e54	\N	root	취업 성공	{자기분석,이력서/자소서,"면접 준비","직무 역량","기업 분석",포트폴리오,"인맥 구축","멘탈 관리"}	0	0	\N	2026-03-10 00:53:46.223+00	2026-03-10 00:53:46.223+00
b3a1be89-d4f2-4886-a953-2d9da4d4a47a	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	자기분석	자기분석	{"자기분석 1","자기분석 2","자기분석 3","자기분석 4","자기분석 5","자기분석 6","자기분석 7","자기분석 8"}	0	1	\N	2026-03-10 00:53:46.229+00	2026-03-10 00:53:46.229+00
9a67a32d-342f-4c7b-85ba-8e9cbdb16c20	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	이력서/자소서	이력서/자소서	{"이력서/자소서 1","이력서/자소서 2","이력서/자소서 3","이력서/자소서 4","이력서/자소서 5","이력서/자소서 6","이력서/자소서 7","이력서/자소서 8"}	1	1	\N	2026-03-10 00:53:46.237+00	2026-03-10 00:53:46.237+00
6884ecaf-2195-41a9-b83d-10e98c324504	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	면접준비	면접 준비	{"면접 준비 1","면접 준비 2","면접 준비 3","면접 준비 4","면접 준비 5","면접 준비 6","면접 준비 7","면접 준비 8"}	2	1	\N	2026-03-10 00:53:46.244+00	2026-03-10 00:53:46.244+00
813f3df9-f712-43ab-a604-dc66ec980446	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	직무역량	직무 역량	{"직무 역량 1","직무 역량 2","직무 역량 3","직무 역량 4","직무 역량 5","직무 역량 6","직무 역량 7","직무 역량 8"}	3	1	\N	2026-03-10 00:53:46.258+00	2026-03-10 00:53:46.258+00
abc085a2-f9f4-4a37-819b-2bc84438f761	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	기업분석	기업 분석	{"기업 분석 1","기업 분석 2","기업 분석 3","기업 분석 4","기업 분석 5","기업 분석 6","기업 분석 7","기업 분석 8"}	4	1	\N	2026-03-10 00:53:46.265+00	2026-03-10 00:53:46.265+00
98e50708-447e-4b10-851b-aaee70fe8558	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	포트폴리오	포트폴리오	{"포트폴리오 1","포트폴리오 2","포트폴리오 3","포트폴리오 4","포트폴리오 5","포트폴리오 6","포트폴리오 7","포트폴리오 8"}	5	1	\N	2026-03-10 00:53:46.272+00	2026-03-10 00:53:46.272+00
58c9a389-011a-478f-a9f4-5af465e97a6b	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	인맥구축	인맥 구축	{"인맥 구축 1","인맥 구축 2","인맥 구축 3","인맥 구축 4","인맥 구축 5","인맥 구축 6","인맥 구축 7","인맥 구축 8"}	6	1	\N	2026-03-10 00:53:46.28+00	2026-03-10 00:53:46.28+00
a8527e7b-8a73-4f4e-955a-8e9d70ed2249	4bb28086-7705-4523-9b9d-d28303fa7e54	10f3a669-4407-430d-ac29-7b77478b0989	멘탈관리	멘탈 관리	{"멘탈 관리 1","멘탈 관리 2","멘탈 관리 3","멘탈 관리 4","멘탈 관리 5","멘탈 관리 6","멘탈 관리 7","멘탈 관리 8"}	7	1	\N	2026-03-10 00:53:46.286+00	2026-03-10 00:53:46.286+00
a78b64a3-9da5-4666-aec7-b618b4fc4eca	d503f4a0-32a6-43d2-a991-12d96592115b	\N	root	2026년 목표	{프로그래밍,"건강 관리",독서,"영어 학습",재테크,인간관계,"취미 생활",자기계발}	0	0	\N	2026-03-10 01:00:24.696+00	2026-03-10 01:00:24.696+00
29bad4bd-0f9d-4cf3-b5ba-3957841c09af	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	프로그래밍	프로그래밍	{"프로그래밍 1","프로그래밍 2","프로그래밍 3","프로그래밍 4","프로그래밍 5","프로그래밍 6","프로그래밍 7","프로그래밍 8"}	0	1	\N	2026-03-10 01:00:24.703+00	2026-03-10 01:00:24.703+00
08a0f328-a082-4a6c-85fc-dc55bb9aa09c	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	건강관리	건강 관리	{"건강 관리 1","건강 관리 2","건강 관리 3","건강 관리 4","건강 관리 5","건강 관리 6","건강 관리 7","건강 관리 8"}	1	1	\N	2026-03-10 01:00:24.71+00	2026-03-10 01:00:24.71+00
33d0c1e9-00f6-4716-a4a0-646302ef2579	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	독서	독서	{"독서 1","독서 2","독서 3","독서 4","독서 5","독서 6","독서 7","독서 8"}	2	1	\N	2026-03-10 01:00:24.716+00	2026-03-10 01:00:24.716+00
09d777a0-4374-4bac-abb4-37f7bc5493bc	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	영어학습	영어 학습	{"영어 학습 1","영어 학습 2","영어 학습 3","영어 학습 4","영어 학습 5","영어 학습 6","영어 학습 7","영어 학습 8"}	3	1	\N	2026-03-10 01:00:24.724+00	2026-03-10 01:00:24.724+00
1ba0146a-a564-4f34-8c98-e7c076e79c60	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	재테크	재테크	{"재테크 1","재테크 2","재테크 3","재테크 4","재테크 5","재테크 6","재테크 7","재테크 8"}	4	1	\N	2026-03-10 01:00:24.73+00	2026-03-10 01:00:24.73+00
6b644e19-b025-4c97-a662-3e7879d447c0	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	인간관계	인간관계	{"인간관계 1","인간관계 2","인간관계 3","인간관계 4","인간관계 5","인간관계 6","인간관계 7","인간관계 8"}	5	1	\N	2026-03-10 01:00:24.736+00	2026-03-10 01:00:24.736+00
26eeac3d-080f-49b7-b21a-595e2ed3eb34	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	취미생활	취미 생활	{"취미 생활 1","취미 생활 2","취미 생활 3","취미 생활 4","취미 생활 5","취미 생활 6","취미 생활 7","취미 생활 8"}	6	1	\N	2026-03-10 01:00:24.743+00	2026-03-10 01:00:24.743+00
208540e2-68e1-449a-a02f-c9b030b69ba6	d503f4a0-32a6-43d2-a991-12d96592115b	a78b64a3-9da5-4666-aec7-b618b4fc4eca	자기계발	자기계발	{"자기계발 1","자기계발 2","자기계발 3","자기계발 4","자기계발 5","자기계발 6","자기계발 7","자기계발 8"}	7	1	\N	2026-03-10 01:00:24.75+00	2026-03-10 01:00:24.75+00
86ea713a-4522-44fb-aa27-2829cde4dd48	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	\N	root	2026년 목표	{프로그래밍,"건강 관리",독서,"영어 학습",재테크,인간관계,"취미 생활",자기계발}	0	0	\N	2026-03-11 03:05:57.763+00	2026-03-11 03:05:57.763+00
5e741296-a6eb-4766-ba40-f83b2c4197cc	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	프로그래밍	프로그래밍	{"프로그래밍 1","프로그래밍 2","프로그래밍 3","프로그래밍 4","프로그래밍 5","프로그래밍 6","프로그래밍 7","프로그래밍 8"}	0	1	\N	2026-03-11 03:05:57.772+00	2026-03-11 03:05:57.772+00
0541ebd2-d4a4-4d39-b629-18e21b9b920e	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	건강관리	건강 관리	{"건강 관리 1","건강 관리 2","건강 관리 3","건강 관리 4","건강 관리 5","건강 관리 6","건강 관리 7","건강 관리 8"}	1	1	\N	2026-03-11 03:05:57.783+00	2026-03-11 03:05:57.783+00
0597af13-7c74-45c2-adfb-14c19902eb4e	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	독서	독서	{"독서 1","독서 2","독서 3","독서 4","독서 5","독서 6","독서 7","독서 8"}	2	1	\N	2026-03-11 03:05:57.79+00	2026-03-11 03:05:57.79+00
8e656ad9-65fd-48b0-ae3d-e4d401eb6caa	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	영어학습	영어 학습	{"영어 학습 1","영어 학습 2","영어 학습 3","영어 학습 4","영어 학습 5","영어 학습 6","영어 학습 7","영어 학습 8"}	3	1	\N	2026-03-11 03:05:57.796+00	2026-03-11 03:05:57.796+00
e474ddd0-2d11-4ea5-b995-0221b06fa5d8	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	재테크	재테크	{"재테크 1","재테크 2","재테크 3","재테크 4","재테크 5","재테크 6","재테크 7","재테크 8"}	4	1	\N	2026-03-11 03:05:57.803+00	2026-03-11 03:05:57.803+00
3ad3f85b-c8cd-4f6e-a95a-8d95db2745db	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	인간관계	인간관계	{"인간관계 1","인간관계 2","인간관계 3","인간관계 4","인간관계 5","인간관계 6","인간관계 7","인간관계 8"}	5	1	\N	2026-03-11 03:05:57.81+00	2026-03-11 03:05:57.81+00
5fe9fb97-f557-4e72-9c00-f3a67950e81e	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	취미생활	취미 생활	{"취미 생활 1","취미 생활 2","취미 생활 3","취미 생활 4","취미 생활 5","취미 생활 6","취미 생활 7","취미 생활 8"}	6	1	\N	2026-03-11 03:05:57.816+00	2026-03-11 03:05:57.816+00
a4550aec-b031-4c39-a25d-a63eb121b710	aa7af62b-c8c2-4d2a-964a-d4a5ee788700	86ea713a-4522-44fb-aa27-2829cde4dd48	자기계발	자기계발	{"자기계발 1","자기계발 2","자기계발 3","자기계발 4","자기계발 5","자기계발 6","자기계발 7","자기계발 8"}	7	1	\N	2026-03-11 03:05:57.822+00	2026-03-11 03:05:57.822+00
1ccf1027-a492-4b78-bc4d-e3bc4a088e78	8514498d-9292-489d-8cd0-797a7d111976	\N	root	AI/ML Expert	{"Math Foundations","Python Mastery","Machine Learning","Deep Learning","Data Engineering",MLOps,"Paper Reading",Projects}	0	0	\N	2026-03-13 07:02:23.067+00	2026-03-13 07:02:23.067+00
05246d19-e7ec-418b-92f2-ec78fec5e187	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	mathfoundations	Math Foundations	{"Math Foundations 1","Math Foundations 2","Math Foundations 3","Math Foundations 4","Math Foundations 5","Math Foundations 6","Math Foundations 7","Math Foundations 8"}	0	1	\N	2026-03-13 07:02:23.087+00	2026-03-13 07:02:23.087+00
aacff042-e9e2-444e-9fd6-f543e7d4b2db	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	pythonmastery	Python Mastery	{"Python Mastery 1","Python Mastery 2","Python Mastery 3","Python Mastery 4","Python Mastery 5","Python Mastery 6","Python Mastery 7","Python Mastery 8"}	1	1	\N	2026-03-13 07:02:23.096+00	2026-03-13 07:02:23.096+00
0bf52254-c89e-45d4-805b-928986c24530	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	machinelearning	Machine Learning	{"Machine Learning 1","Machine Learning 2","Machine Learning 3","Machine Learning 4","Machine Learning 5","Machine Learning 6","Machine Learning 7","Machine Learning 8"}	2	1	\N	2026-03-13 07:02:23.1+00	2026-03-13 07:02:23.1+00
d04554c2-d384-4788-a91b-e5c5080fbc4a	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	deeplearning	Deep Learning	{"Deep Learning 1","Deep Learning 2","Deep Learning 3","Deep Learning 4","Deep Learning 5","Deep Learning 6","Deep Learning 7","Deep Learning 8"}	3	1	\N	2026-03-13 07:02:23.104+00	2026-03-13 07:02:23.104+00
4e383479-8ccb-42da-a85a-fa0bc277dec0	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	dataengineering	Data Engineering	{"Data Engineering 1","Data Engineering 2","Data Engineering 3","Data Engineering 4","Data Engineering 5","Data Engineering 6","Data Engineering 7","Data Engineering 8"}	4	1	\N	2026-03-13 07:02:23.109+00	2026-03-13 07:02:23.109+00
de6500fa-4209-49b0-998c-20f855b72e86	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	mlops	MLOps	{"MLOps 1","MLOps 2","MLOps 3","MLOps 4","MLOps 5","MLOps 6","MLOps 7","MLOps 8"}	5	1	\N	2026-03-13 07:02:23.114+00	2026-03-13 07:02:23.114+00
6166d7b8-496f-4f5c-b902-b5b290d9261c	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	paperreading	Paper Reading	{"Paper Reading 1","Paper Reading 2","Paper Reading 3","Paper Reading 4","Paper Reading 5","Paper Reading 6","Paper Reading 7","Paper Reading 8"}	6	1	\N	2026-03-13 07:02:23.119+00	2026-03-13 07:02:23.119+00
03381274-b930-4136-ba7d-e10429357ec1	8514498d-9292-489d-8cd0-797a7d111976	1ccf1027-a492-4b78-bc4d-e3bc4a088e78	projects	Projects	{"Projects 1","Projects 2","Projects 3","Projects 4","Projects 5","Projects 6","Projects 7","Projects 8"}	7	1	\N	2026-03-13 07:02:23.124+00	2026-03-13 07:02:23.124+00
\.


--
-- Data for Name: user_subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_subscriptions (id, user_id, tier, local_cards_limit, created_at, updated_at) FROM stdin;
e8bba7f8-5344-478c-9b9d-8e9ff468ef11	0192fedf-85f4-47ab-a652-7fdd116e2b39	free	10	2026-03-04 16:10:46.745567+00	2026-03-04 16:10:46.745567+00
478299c5-9172-4437-9657-6770b3bd174e	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	free	10	2026-03-06 00:53:54.564604+00	2026-03-06 00:53:54.564604+00
28ef6747-78ce-4fa9-b0fe-bf7c65c0fe40	baaa7b67-434f-4d9c-ad1e-2126b4895348	free	10	2026-03-06 06:34:44.524959+00	2026-03-06 06:34:44.524959+00
0b3e0ed7-6b15-4d63-9b7b-447725f485b4	af12c5e9-2399-4e92-869c-d31d916cce44	free	10	2026-03-06 08:20:51.580659+00	2026-03-06 08:20:51.580659+00
047f8850-99c6-449b-9baf-0dc5f9f5b391	190605aa-8e78-45b6-8291-12a156ff17da	free	10	2026-03-10 00:25:33.682539+00	2026-03-10 00:25:33.682539+00
8d41f1eb-5e54-4c48-93fc-f0934dc3dbba	6c99732d-182e-4346-844e-67ea7b2d9940	free	10	2026-03-10 11:20:36.021914+00	2026-03-10 11:20:36.021914+00
\.


--
-- Data for Name: user_ui_preferences; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_ui_preferences (id, user_id, scratchpad_is_floating, scratchpad_dock_position, scratchpad_position_x, scratchpad_position_y, scratchpad_width, scratchpad_height, mandala_is_floating, mandala_is_minimized, mandala_dock_position, mandala_position_x, mandala_position_y, created_at, updated_at) FROM stdin;
b959c7f1-34f3-4f6a-91ca-88ec32f0e689	3f66a12c-b6da-452b-b5e3-f0c9432b6b53	f	top	613	210	320	320	t	f	left	69	93	2026-03-06 00:54:04.479031+00	2026-03-11 03:11:03.448+00
2f9f2adf-2fd0-4226-8c1e-fa924d7675c0	0192fedf-85f4-47ab-a652-7fdd116e2b39	f	top	1138	198	320	320	f	f	right	701	102	2026-03-05 01:03:37.612208+00	2026-03-12 00:10:35.269+00
22f13d56-f27c-43cd-a7c4-63b4464016cc	190605aa-8e78-45b6-8291-12a156ff17da	f	left	569	224	320	320	f	f	left	100	80	2026-03-10 00:32:46.026775+00	2026-03-14 01:31:45.442+00
\.


--
-- Data for Name: youtube_videos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.youtube_videos (id, youtube_video_id, title, description, thumbnail_url, channel_title, duration_seconds, published_at, view_count, like_count, created_at, updated_at) FROM stdin;
24bd31fe-2357-4d1f-9152-5e1d671cee3a	9gAaZPCJLyU	랭그래프 선택하셨나요? 저라면 안 씁니다	🤖 Claude Code + Vibe Coding | 코딩 1도 몰라도 10분 만에 앱 만드는 법\n\n📚 클로드 코드 설치 가이드 (PDF)\nhttps://drive.google.com/file/d/1wWQb...\n\n📦 바이브 코딩 스타터 키트\nhttps://github.com/chacha95/claude-co...\n\n⏱️ 타임스탬프\n\n\n🔗 메이커 에반 채널\nThreads: https://www.threads.com/@ai.vibecoding\nwebsite: https://www.vrl.co.kr/\n전자책: https://www.latpeed.com/products/S7_1B\n\n#바이브코딩 #VibeCoding #ClaudeCode #클로드코드 #AI코딩 #노코드 #코딩입문 #AI앱만들기 #1인개발 #사이드프로젝트 #메이커에반	https://i.ytimg.com/vi/9gAaZPCJLyU/default.jpg	메이커 에반 | Maker Evan	426	2026-03-07 06:28:00+00	9043	349	2026-03-11 06:33:42.801+00	2026-03-11 06:33:42.801+00
763f18a0-38ff-41d9-ab99-728418861f3e	DTPAjxbcsxs	삼성 드디어 AI로 일 냈다? Gemini, 딥시크 다 이긴 10,000의 1 크기 TRM 의미	최근 AI 연구계에서 큰 화제를 모은 논문이 있습니다.\n고작 1만분의 1 크기의 작은 AI가 구글 제미니 같은 거대 모델의 성능을 압도했다는 소식 때문입니다. 이 영상은 'TRM'이라는 이 작은 AI가 어떻게 인간조차 풀기 어려운 논리 퍼즐들을 해결했는지 그 원리를 파헤칩니다. 스스로의 답변을 끊임없이 검토하고 수정해나가는 독특한 재귀적 추론 방식에 대해 알기 쉽게 설명합니다. 하지만 '작은 AI가 거대 AI를 이겼다'는 자극적인 헤드라인 뒤에 숨겨진 진실을 비판적으로 분석합니다. 두 AI가 경쟁한 조건과 방식이 공정했는지, 그들의 근본적인 목적은 어떻게 다른지 짚어봅니다. '전문가 AI'와 '범용 AI'의 차이를 통해 이번 사건의 진짜 의미를 조명합니다. 단순히 모델의 크기가 아닌, AI의 '효율'과 '목적성'에 대한 새로운 관점을 제시하고자 합니다.\n\nWritten by Error\nEdited by Error\n\nunrealtech2021@gmail.com	https://i.ytimg.com/vi/DTPAjxbcsxs/default.jpg	안될공학 - IT 테크 신기술	806	2025-10-11 11:54:50+00	49169	1202	2026-03-06 08:41:28.118+00	2026-03-06 08:41:28.118+00
2776e142-5948-43d9-8b3c-a5c8752e3476	NPiKEwTSwn4	Google’s AI Search Expert: How to Get Ahead Before AI Changes Everything	📌 Grab for FREE guide for using Gemini for faster research, smarter strategy, and scalable content creation: https://clickhubspot.com/186fae \n\nWhat makes AI recommend one business - and ignore another?\nIn this interview, Robby Stein, VP of Product for Google Search, breaks down how AI now decides what gets discovered, ranked, and recommended — and what founders, creators, and marketers can do to stay visible in the new era of search. \n\n00:00 - Teaser \n1:00 - How Google Search has changed \n2:08 - Personalization in Google search\n2:47 - New features in AI mode at Google \n3:05 - Live DEMO: testing new features\n4:07 - Google can book restaurants? \n6:02 - How Google decides which restaurants to show first \n7:24 - How to use Gemini to save hours at work\n8:39 - Will Google Ads disappear? \n11:08 - LIVE DEMO: Google’s agent makes a real phone call\n14:07 - How to get your business recommended by AI\n15:00 - Why PR will define visibility in the AI era\n15:45 - What to do if businesses buy reviews\n16:20 - How to grow fast with smarter search strategies\n18:03 - Shopping powered by AI - what’s changing \n18:48 - LIVE DEMO: shopping by taking a picture \n20:20 - Google vs ChatGPT\n22:50  - How to design your home with AI\n24:25 - TIPS to build products that stand out in the AI era \n25:58 - How to find ideas that actually work\n27:20  - The 2 principles behind every viral product\n\n\nLinks: \n📩 Follow my Newsletter: https://siliconvalleygirl.beehiiv.com/\n\n🔗 My Instagram: https://www.instagram.com/siliconvalleygirl/ \n\n📌 My Companies & Products: https://Marinamogilko.co\n\n📹 Video brainstorming, research, and project planning - all in one place - https://partner.spotterstudio.com/ideas-with-marina \n\n💻 Resources that helps my team and me grow the business:\n- Email & SMS Marketing Automation - https://your.omnisend.com/marina\n- AI app to work with docs and PFDs - https://www.chatpdf.com/?via=marina\n\n📱Develop your YouTube with AI apps:\n- AI tool to edit videos in a minutes https://get.descript.com/fa2pjk0ylj0d\n- Boost your view and subscribers on YouTube - https://vidiq.com/marina\n- #1 AI video clipping tool - https://www.opus.pro/?via=7925d2\n\n💰 Investment Apps:\n- Top credit cards for free flights, hotels, and cash-back - https://www.cardonomics.com/i/marina\n- Intuitive platform for stocks, options, and ETFs - https://a.webull.com/Tfjov8wp37ijU849f8\n\n⭐ Download my English language workbook - https://bit.ly/3hH7xFm\n\nI use affiliate links whenever possible (if you purchase items listed above using my affiliate links, I will get a bonus).\n\n#podcast #siliconvalleygirl #google	https://i.ytimg.com/vi/NPiKEwTSwn4/default.jpg	Silicon Valley Girl	1693	2025-10-30 16:21:37+00	34247	776	2026-03-06 08:41:28.142+00	2026-03-06 08:41:28.142+00
b736573b-a85b-4b55-9f7e-f4bd13ec2165	knwG2f0FHDw	AI로 삶을 바꾸는 사람들이 알고 있는 한 가지 원리 (제미나이, 노트북LM 사용법)	구글의 Gemini와 NotebookLM, 잘 쓰고 계신가요?\n제가 어떻게 Gemini로 좋은 자료들을 찾아내는지에 대해 중점적으로 다룹니다.\n그렇게 좋은 자료를 찾았다면, \n이제 NotebookLM을 사용해서 나에게 맞는 형태로 변형하고 무궁무진하게 활용하시면 됩니다.\n\n00:00 인트로\n01:30 환각을 최소화하는 법\n02:30 필요한 자료 수집하는 법\n03:21 내가 쓴 프롬프트 & 검색연산자란?\n06:21 노트북LM 사용법\n09:38 한 가지 원리\n10:21 꼭 하고 싶은 말\n\n#제미나이 #노트북LM #gemini #notebooklm	https://i.ytimg.com/vi/knwG2f0FHDw/default.jpg	아자캄 | 브랜드를 만드는 AI 활용법	708	2025-09-24 05:45:05+00	26196	843	2026-03-06 08:41:28.193+00	2026-03-06 08:41:28.193+00
cbab6a7d-6290-448c-a3fd-8b9450939440	pey9u_ANXZM	How I Tamed Claude - Emmz Rendle - NDC London 2026	This talk was recorded at NDC London in London, England. #ndclondon  #ndcconferences #developer #softwaredeveloper    \n\nAttend the next NDC conference near you: \nhttps://ndcconferences.com\nhttps://ndclondon.com/\n\nSubscribe to our YouTube channel and learn every day:   \n/        @NDC \n\nFollow our Social Media!\n\nhttps://www.facebook.com/ndcconferences\nhttps://twitter.com/NDC_Conferences\nhttps://www.instagram.com/ndc_conferences/\n\n#ai #architecture #machinelearning #crossplatform \n\nI'm the CTO of a very small, very hi-tech company, which means I'm working on multiple things simultaneously.\n\nTo do this, I've developed a process for working with coding agents, particularly Claude Code, which allows me to switch context rapidly and do things I don't 100% know how to do myself.\n\nIn this talk I'll share the techniques I've learned, developed and refined that help me get solid, usable code that I can put into production with confidence. I'll show you how to write a detailed requirements document that an agent can work from; how to work through those requirements step by step in collaboration with your LLM; how to maintain state between sessions (which is helpful for me as well as Claude); and how to keep up with what it's doing so you can take responsibility for the solution long after its context window has closed forever.\n\nI'll also share some thoughts about where junior developers fit into this new way of working, and how important it is that humans continue to be the primary agents in software engineering.	https://i.ytimg.com/vi/pey9u_ANXZM/default.jpg	NDC Conferences	3971	2026-02-09 14:07:49+00	26609	638	2026-03-06 08:41:28.205+00	2026-03-06 08:41:28.205+00
5d122b0b-3266-4964-acb7-a9690592c5de	30diF8dKpAY	Google Generative AI Leader Certification Course – Pass the Exam!	Prepare for the Google Generative AI Leader exam and pass! Andrew Brown is a CTO who has passed practically every DevOps exam under the sun, and he teaches this course. \n\nHe'll give you a business-level knowledge of Google Cloud's gen AI offerings. By the end of this course, you'll be set to sit for the exam.\n\n🔗 Get your Free Practice and Downloadable Cheatsheets: https://www.exampro.co/gcp-gal \n\n❤️ Support for this channel comes from our friends at Scrimba – the coding platform that's reinvented interactive learning: https://scrimba.com/freecodecamp\n\n⭐️ Contents ⭐️\n- 00:00:00 Introduction\n- 00:26:49 Core General AI Concepts\n- 01:14:40 Security\n- 01:17:01 Vertex Search\n- 01:43:35 Model\n- 01:54:42 Engagement Suite\n- 02:20:31 Google Agentspace\n- 02:29:34 Gemini with Google Workspace\n- 02:37:09 Vertex AI Studio\n- 03:17:20 Agent Builder\n\n🎉 Thanks to our Champion and Sponsor supporters:\n👾 Drake Milly\n👾 Ulises Moralez\n👾 Goddard Tan\n👾 David MG\n👾 Matthew Springman\n👾 Claudio\n👾 Oscar R.\n👾 jedi-or-sith\n👾 Nattira Maneerat\n👾 Justin Hual\n\n--\n\nLearn to code for free and get a developer job: https://www.freecodecamp.org\n\nRead hundreds of articles on programming: https://freecodecamp.org/news	https://i.ytimg.com/vi/30diF8dKpAY/default.jpg	freeCodeCamp.org	12260	2025-10-13 13:49:05+00	155393	2857	2026-03-06 08:41:28.089+00	2026-03-06 08:41:28.089+00
fabc918b-cfeb-42c3-b48e-cbba77d79de1	3NzCBIcIqD0	10 CLI Tools I'm using alongside Claude Code | Starmorph AI	10 CLI Tools I’m Using with Claude Code (LazyGit, Glow, Zoxide, Btop, eza + More)\n\nBlog Post guide with Links: \nhttps://blog.starmorph.com/blog/10-cli-tools-for-ai-coding#1-lazygit\n\nBrowse Starmorph Config files library https://starmorph.com/config\n\nOverview\nThe video covers 10 command-line tools ive been using alongside Claude Code while spending more time in the terminal. It demonstrates LazyGit for monitoring repo status and reviewing changes Claude makes, Glow as a CLI markdown reader (with NeoVim mentioned for deeper navigation and editing), and LLM Fit for estimating which local AI models can run on the current hardware. It also shows the Models CLI for comparing model providers, pricing, context, agent changelogs, and benchmark results. Additional tools include Taproom for browsing Homebrew casks and installed packages, Ranger as a terminal file explorer for remote/Linux workflows, Zoxide for smarter fuzzy directory jumping instead of manual cd paths, Btop (and MacTop on macOS) for viewing system resources and processes, Shah for rendering images directly in the terminal, CSV Lens for viewing CSVs in a TUI, and eza as an enhanced ls alternative with icons and grid/grouping options. The creator closes by inviting comments for deeper future videos on individual tools.\n\n\nChapters\n00:00 Intro: 10 CLI Tools I Use with Claude Code\n00:13 LazyGit: Track Repo Changes as Claude Edits\n01:06 Glow + Neovim: Read & Navigate Markdown in Terminal\n02:21 LLM Fit: What Models Can Run on Your Hardware?\n03:11 Models CLI: Providers, Pricing, Benchmarks & Agent Changelogs\n04:16 Taproom: Browse Homebrew Casks & Formulae\n05:04 Ranger: Terminal File Manager for Remote/Linux Work\n05:25 Zoxide: Smarter `cd` with Fuzzy Jumping\n06:11 Btop & MacTop: Monitor System Resources and Processes\n07:24 Terminal Viewers: Render Images (shaa) + Inspect CSVs (csvlens)\n08:18 eza: A Better `ls` for Busy Terminal Workflows\n09:23 Wrap-Up: More Tool Deep Dives + Viewer Requests\n\nLinks to packages mentioned \n- [LazyGit](#1-lazygit) https://github.com/jesseduffield/lazygit\n- [Glow](#2-glow) https://github.com/charmbracelet/glow\n- [LLM Fit](#3-llm-fit) https://github.com/AlexsJones/llmfit\n- [Models CLI](#4-models-cli) models  https://github.com/arimxyer/models\n- [Taproom](#5-taproom) https://github.com/hzqtc/taproom\n- [Ranger](#6-ranger) https://github.com/ranger/ranger\n- [Zoxide](#7-zoxide) https://github.com/ajeetdsouza/zoxide\n- [Btop](#8-btop) https://github.com/aristocratos/btop\n- [Chafa](#9-chafa)  https://github.com/hpjansson/chafa\n- [CSV Lens](#10-csv-lens) https://github.com/YS-L/csvlens\n- [Bonus: eza](#bonus-eza) https://github.com/eza-community/eza\n\n📡 Starmorph AI: https://Starmorph.com\n🐦 Follow us on Twitter: https://twitter.com/StarmorphAI	https://i.ytimg.com/vi/3NzCBIcIqD0/default.jpg	StarMorph AI	591	2026-02-22 21:32:05+00	80120	2970	2026-03-11 06:33:42.724+00	2026-03-11 06:33:42.724+00
7d7cdab8-e789-4fde-ba3f-139a260e6958	6BA_-zBLMUc	900배 빨라진다는 Claude Code 히든기능? - 찐 개발자가 직접 파헤침.	Claude Code에 숨겨진 LSP 기능, 진짜 900배 빨라질까?\n직접 세팅하고, 실제 프로젝트에서 돌려보고, 검증까지 해봤습니다.\n\n  📌 타임라인\n  00:00 인트로 - 900배 빨라진다고?\n  02:20 LSP란 무엇인가\n  03:40 LSP 세팅 방법 (2분이면 끝)\n  05:15 실전 검증 - grep vs LSP\n  07:35 결론 - LSP 써야 할까?\n\n\n# Python\nnpm i -g pyright\n\n# TypeScript\nnpm i -g typescript-language-server typescript\n\nclaude plugin marketplace update claude-plugins-official\nclaude plugin install pyright-lsp # Python\nclaude plugin install typescript-lsp  # TypeScript\n\n #ClaudeCode #바이브코딩 #LSP #AI코딩 #개발자	https://i.ytimg.com/vi/6BA_-zBLMUc/default.jpg	김플립 - LLM 코딩	447	2026-03-06 00:00:05+00	6688	191	2026-03-11 06:33:42.758+00	2026-03-11 06:33:42.758+00
f048abf6-d977-48a7-929d-9045e17fa700	9_KaOylab6c	깃허브 스타 4천 개 터진 '클로드 코드' 활용법, 30년 차 개발자가 15개로 압축해 드립니다.	[바이브랩스] 깃허브를 달군 클로드 코드 팁 45가지 중, 핵심 15가지만 뽑았습니다.\n\n안녕하세요, 바이브랩스 랩장 이석현입니다.\n최근 깃허브에서 72시간 만에 스타 6만 개(4,200개로 수정합니다. 6만개 잘못된 정보입니다.)를 받은 엄청난 인기 글, '클로드 코드 활용 45가지'를 보셨나요?\n내용은 너무 좋지만 45개를 전부 보기엔 시간이 부족한 분들을 위해, 당장 실전에 써먹을 수 있는 핵심 팁 15가지만 추려봤습니다.\n\n타이핑보다 빠른 음성 코딩부터, 터미널 공포증을 극복하는 방법, 그리고 나만의 도구를 만드는 '바이브 코딩'의 진정한 의미까지 영상 하나에 모두 담았습니다. AI를 활용해 생산성을 극대화하고 싶은 분들께 이 영상이 훌륭한 무기가 되길 바랍니다.\n\n매주 토요일 라이브 방송에서도 AI와 코딩에 대한 다채로운 이야기를 나누고 있으니 많은 참여 부탁드립니다!\n\n[참고 자료 & 출처]\n\n깃허브 원문 출처 : https://github.com/ykdojo/claude-code-tips?tab=readme-ov-file\n\n[바이브랩스 커뮤니티 & 작가 도서 목록]\n💬 바이브랩스 작가 오픈톡방 : https://open.kakao.com/o/gfYQfFPh\n📖 [실무에 바로 쓰는 일잘러의 챗GPT 프롬프트 74가지] : https://www.yes24.com/product/goods/159060578\n📖 [바이브 코딩 커서 AI와 클로드 코드로 누구나!] : https://www.yes24.com/product/goods/161924116\n📖 [챗GPT, 글쓰기 코치가 되어 줘 : 교양부문 세종우수도서] : https://www.yes24.com/product/goods/144539067\n\n[비즈니스 & 작가 제안]\n✉️ futurewave@gmail.com\n\n⏱️ 타임라인 (디테일)\n00:00 깃허브 스타 6만 개! 클로드 코드 화제의 글 소개\n00:12 45개는 너무 많다, 30년 개발 내공으로 15개 필터링\n00:22 클로드 코드란 무엇인가? (터미널 공포증 극복하기)\n00:39 [팁 1] 타이핑보다 말이 빠르다 (음성 입력 활용법)\n01:00 [팁 2] AI 소통 최적 형식, 마크다운(Markdown)이 최고다\n01:22 [팁 3] 별칭을 설정하라 (매번 claude 다 치지 마세요)\n01:42 [팁 4] 쓰는 게 최고다 (10억 토큰의 법칙)\n01:58 [팁 5] 한 번에 시키지 말고 쪼개서 시켜라 (A에서 B로의 법칙)\n02:30 [팁 6] 컨텍스트는 우유다 (대화가 길어지면 멍청해지는 AI)\n02:55 [팁 7] 완벽주의는 사치, 프로토타입부터 빠르게 만들자\n03:10 [팁 8] Git은 3줄만 알면 된다 (커밋, PR, 푸시)\n03:36 [팁 9] 결과물을 꺼내는 법 (/copy 명령어 활용)\n03:55 [팁 10] 터미널 탭 여러 개 열기 (계단식 멀티태스킹)\n04:25 [팁 11] 막힌 사이트는 제미나이(Gemini)로 우회하라\n04:42 [팁 12] AI 업무 매뉴얼, Claude.md를 적극 활용하자\n05:14 [팁 13] 클로드 코드는 코딩 도구가 아니다 (만능 인터페이스)\n05:41 [팁 14] 내 맞춤형 도구를 만들자 (바이브 코딩의 진정한 의미)\n06:01 [팁 15] 배운 건 적극 나누자 (공유의 문화)\n06:22 [요약] 입문자, 실전, 고급 편 핵심 총정리\n06:49 바이브랩스 채널 안내 및 아웃트로	https://i.ytimg.com/vi/9_KaOylab6c/default.jpg	바이브랩스	429	2026-03-06 06:18:11+00	7076	323	2026-03-11 06:33:42.778+00	2026-03-11 06:33:42.778+00
6ff82851-87b1-42c0-bd21-e47d74ffef5f	TUKYbUIXLOE	The 6 Levels of Claude Code Explained	⚡Master Claude Code, Build Your Agency, Land Your First Client⚡\nhttps://www.skool.com/chase-ai\n\n🔥FREE community with tons of AI resources🔥 \nhttps://www.skool.com/chase-ai-community\n\n💻 Need custom work? Book a consult 💻\nhttps://chaseai.io\n\nMastering Claude Code can be difficult, especially without a roadmap.\n\nIn this video, I give you that map as I break down the 6 levels of Claude Code progression, giving you the exact skills you need to master and the traps you need to avoid in order to never stall in your Claude Code progress.\n\n⏰TIMESTAMPS:\n\n0:00 The Roadmap Problem\n1:10 Level 1\n4:22 Level 2\n7:33 Level 3\n13:33 Level 4\n19:54 Level 5\n24:39 Level 6\n32:08 More Resources\n\nRESOURCES FROM THIS VIDEO:\n➡️ Master Claude Code: https://www.skool.com/chase-ai\n➡️ My Website: https://www.chaseai.io\n\n#claudecode	https://i.ytimg.com/vi/TUKYbUIXLOE/default.jpg	Chase AI	1956	2026-03-08 22:01:16+00	41438	1426	2026-03-11 06:33:42.936+00	2026-03-11 06:33:42.936+00
1a5c61b0-dbb0-4e45-9cdf-06ea7eeee01b	UM9FmXJQ3yg	클로드 코드로 유튜브 영상을 자동화할 수 있다고? | Remote Control 실제 활용까지	클로드 코드의 최신 기능과 Remotion을 활용해서 코드로 영상을 만들어봤습니다.\nRemote Control로 폰에서도 이어서 작업하는 과정까지 직접 보여드립니다.\n\n🔗 링크\nRemotion: https://remotion.dev\nRemotion 프롬프트 갤러리: https://remotion.dev/prompts\n\n🙋‍♂️ 소개\n인디 개발자로 AI 서비스를 만들고 있습니다.\n바이브코딩으로 나만의 서비스를 만들고, 자유로운 삶을 만들어가는 여정을 공유합니다.\n\n🌐 Caramell: https://caramell.app\n📷 Riftshot: https://riftshot.com\n🧵 Threads: https://www.threads.com/@jayychoii	https://i.ytimg.com/vi/UM9FmXJQ3yg/default.jpg	Jay Choi | 인디해커 라이프	424	2026-03-09 06:59:01+00	2842	150	2026-03-11 06:33:42.952+00	2026-03-11 06:33:42.952+00
61f7ce38-2295-4b4f-8723-a1600ea7517b	LHx_EFoLonQ	코딩 에이전트 성능을 20배 올리는 가장 쉬운 방법 | AGENTS.md로 표준 규칙 파일 정의하기	지금 바로 정리 시작하세요! \nhttps://clnmy.com/DEVELOP 에서 CleanMyMac을 7일 동안 무료로 체험하고, \n코드 DEVELOP 을 사용해 20% 할인까지 받으세요!  \n\n이번 영상은 CleanMyMac의 유료 광고가 포함되어 있습니다.\n\n✨................................................✨\n\nAI 코딩 에이전트 규칙 파일, 이제는 하나의 규칙 포맷으로 표준화해서 관리할 때입니다.\n\n이번 영상에서는 OpenAI Codex 팀을 포함한 여러 에이전트 팀이 함께 만든 표준 규칙 파일인 AGENTS.md를 소개하고,\n- 왜 AGENTS.md가 필요한지\n- 어떤 에이전트/도구들이 지원하는지\n- 500줄을 넘기지 않는 구조화 방법(중첩 AGENTS.md)\n- 팀 협업에서 어떻게 리뷰/버전관리/온보딩에 활용할지\n까지 실전 관점으로 정리합니다.\n\nAGETNS.md 자동 생성 마스터 프롬프트는 다음 링크에서 확인해보세요!\n🔗 https://fanding.kr/@devbrother/post/168404	https://i.ytimg.com/vi/LHx_EFoLonQ/default.jpg	개발동생	1212	2025-12-18 09:30:14+00	17137	466	2026-03-11 06:33:42.87+00	2026-03-11 06:33:42.87+00
2ed2eda2-7049-41ef-8628-14d7c42cf757	JErg2lwXHl0	Google의 새로운 CLI가 Claude Code의 완벽한 보완입니다.	Google의 새로운 gwscli는 AI 에이전트가 Google Workspace를 쉽게 제어할 수 있게 해주는 혁신적인 도구입니다! 이 영상에서는 gwscli의 기능과 MCP 서버와의 비교를 자세히 살펴봅니다.\n\n핵심 내용:\n• Google Workspace CLI(gwscli)는 Rust로 만들어진 AI 에이전트 전용 CLI 도구입니다\n• 100개 이상의 스킬을 다운로드할 수 있으며, 동적 명령어 생성으로 토큰 사용량을 최소화합니다\n• 복잡한 설정 과정을 거쳐야 하지만, 한 번 설정하면 강력한 기능을 사용할 수 있습니다\n• MCP 서버와 비교했을 때 토큰 효율성이 뛰어나고 이식성이 좋습니다\n• CLI vs MCP 서버의 장단점을 파악하고 자신의 사용 사례에 맞는 선택을 할 수 있습니다\n\n#GoogleWorkspace #GWSCLI #AIAgents #ClaudeCode #MCP\n\n📎 관련 링크:\n• https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/\n• https://github.com/googleworkspace/cli/issues/188\n• https://betterstack.com/\n• https://betterstack.com/community/\n• https://github.com/BetterStackHQ\n• https://twitter.com/betterstackhq\n• https://www.instagram.com/betterstackhq/\n• https://www.tiktok.com/@betterstack\n• https://www.linkedin.com/company/betterstack\n\n출처: Better Stack	https://i.ytimg.com/vi/JErg2lwXHl0/default.jpg	Tech Bridge	531	2026-03-09 04:00:17+00	1505	27	2026-03-11 06:33:42.836+00	2026-03-11 06:33:42.836+00
9c576f69-8d4d-4264-9fa4-7042e678115e	OZTPDK6IhyU	"90%는 아직도 몰라요" 구글 CEO가 경고하는 AI시대 생존	지금은 명백히 AI의 시대입니다.\n구글 CEO 순다르 피차이가 말했죠.\n“AI를 도구로 쓸 줄 아는 사람만 살아남는다.”\n\n그런데 우리는 어떻습니까?\n아직도 뉴스 하나하나 직접 찾고,\n공시 읽고, 리포트 정리하고,\n10년 전이랑 똑같은 방식으로 투자하고 있진 않나요?\n\n이제 투자에서 중요한 건\n더 많은 정보를 찾는 능력이 아닙니다.\n정보는 이미 넘쳐납니다.\n진짜 핵심은 그 많은 정보를 얼마나 빠르고 정확하게 정리해서\n‘돈이 되는 인사이트’로 바꾸느냐입니다.\n\n그래서 이 영상에서는\n제가 실제로 여러 AI를 직접 테스트하면서\n“이건 진짜다”라고 느낀,\n투자자라면 반드시 알아야 할 AI 핵심 기능들만\n딱 골라서 공유합니다.\n\n▶ 영상에서 사용한 프롬프트 : https://bit.ly/4qgtLMM\n\n#챗gpt #챗gpt주식 #챗gpt사용법	https://i.ytimg.com/vi/OZTPDK6IhyU/default.jpg	부코드, AI 활용해서 투자하기	436	2025-12-30 10:30:17+00	160806	6581	2026-03-06 08:41:28.161+00	2026-03-06 08:41:28.161+00
2ef6ca18-1367-4893-b8fe-b96fc952fe03	gdg4DBcakIg	클로드 코드를 이용해 스프링 앱 개발하기 - Live 1	Claude Code 초기 상태에서 스프링 부트 최신 버전과 프론트엔드(nextjs)까지 개발해 나가는 과정을 살짝 보여드립니다. \n\n00:00:00  인트로: 바이브 코딩과 Claude Code 소개\n00:03:07  Claude Code 리셋 철학 & 환경 설정 (Ghostty 터미널)\n00:09:06  Spring Boot 프로젝트 생성 (Initializr, Boot 4.x, Java 25, Gradle 9)\n00:23:05  개발 워크플로우 옵션 (PRD, Plan 모드, SDD, Task 기반)\n00:34:08  PRD 작성 & SDD 변환 (Apple Reminders 클론 기획)\n00:42:27  Task 리스트 생성 (67개 체크 항목, 개발 단계 분류)\n00:51:04  도메인 엔티티 개발 (ReminderList) & 단위 테스트\n01:03:22  CLAUDE.md 코딩 가이드라인 작성\n01:08:06  서비스 레이어 개발 (인터페이스 분리, Ports/Input 패턴, 통합 테스트)\n01:19:22  컨트롤러 & API 개발 (OpenAPI 스펙, MockMVC 테스트)\n01:29:31  Phase 1 완료, 나머지 엔티티 개발, 커밋 & 푸시\n01:36:00  프론트엔드 (Next.js) 셋업 & Phase 2~5 개발\n01:44:05  Git Worktree 병렬 개발 & 상태 표시줄 설정\n01:48:09  상태 표시줄 커스터마이징, Ghostty 팁, Claude Code 문서 추천\n01:55:40  라이브 앱 데모 & Worktree 코드 리뷰\n02:05:00  TDD 버그 수정, Skills/Sub-agent 소개, 마무리\n\n라이브에서 만든 코드는 https://github.com/tobyilee/tobyreminder 에 있습니다.	https://i.ytimg.com/vi/gdg4DBcakIg/default.jpg	토비의 스프링 	7852	2026-03-07 03:22:01+00	9142	410	2026-03-11 06:33:42.97+00	2026-03-11 06:33:42.97+00
e838a1cf-a7aa-4660-817a-1b88df5e3b5c	3cYusISFc9s	How to Use Claude Skills 2.0 Better than 99% of People	Join my AI Accelerator to get all my Claude Plugins, Skills, Templates & Blueprints ⤵️\nhttps://c.benai.co/htucs-acc\n\nFull Claude Skills Tutorial ⤵️\nhttps://youtu.be/X3uum6W2xEI\n\nFull Claude Cowork Tutorial ⤵️\nhttps://youtu.be/HTu1OGWAn5w\n\nWork with my AI Agency ⤵️\nhttps://c.benai.co/htucs-agency\n\nGet our Recruiting Solution ⤵️\nhttps://c.benai.co/htucs-recruit\n\nWe are hiring Marketers and Engineers! Apply here ⤵️\nhttps://ask.benai.co/join-ben-ai\n\n🔗 My Socials:\nLinkedin: https://www.linkedin.com/in/benvansprundel/\nInstagram: https://www.instagram.com/benai_25/\nTiktok: https://www.tiktok.com/@benai_25\nX: https://x.com/ben_vs92\n\n💻 Softwares I use (some of these are affiliate-links, thanks!):\nPrompting Tool: https://promptcowboy.ai/\nn8n: https://n8n.partnerlinks.io/zr6ttnlrb8dw\nRelevance AI: https://relevanceai.com/?via=ben\nMake.com: https://www.make.com/en/register?pc=benai\nApify: https://www.apify.com?fpr=benai\nElevenLabs: https://try.elevenlabs.io/fps0xgonqagd\nSendspark: https://sendspark.com/?via=ben-ai\n\nChapters:\n00:00 – Intro\n00:22 – Example of Skills 2.0\n01:21 – What Are Skills?\n02:26 – How Skills 2.0 Work\n04:30 – Building a Skill from Scratch\n07:12 – How to Use Tests & Evals\n09:22 – Tests & Evals Best Practices\n11:20 – How to Use A/B tests\n13:42 – Context Engineering with A/B Tests\n\n👋🏼 About me:\nI'm Ben. I built two $1M ARR AI Businesses & I (try) to teach others how they can too.\nI believe non-technical professionals have a unique opportunity in the AI era to automate their work and start AI businesses by combining their domain expertise with AI.\n\nI make videos that cover:\n1. How non-technical professionals can automate real work with AI\n2. Step-by-step AI tutorials for marketers, tech professionals & founders\n3. Building AI workflows that actually save you time and generate revenue	https://i.ytimg.com/vi/3cYusISFc9s/default.jpg	Ben AI	951	2026-03-09 10:02:03+00	23464	578	2026-03-12 00:10:00.144+00	2026-03-12 00:10:00.144+00
9005ecb0-a89b-4df2-8373-21225898e02c	S2VCvsE2iOk	중국 GPU 규제가 이렇게 돌아온다... 딥시크의 미친 아이디어, GPU 1/10로 만들다 | 텍스트를 이미지로 10배 압축	LLM이 긴 텍스트를 처리할 때 느려지는 근본적인 문제를 해결할 새로운 아이디어가 등장했습니다. 바로 텍스트를 이미지로 바꾸어 압축하는 '광학적 압축'이라는 개념인데요. 이번 영상에서는 이 혁신적인 아이디어를 구현한 DeepSeek-OCR 논문을 심층적으로 분석합니다. SAM과 CLIP 같은 기존 모델을 독창적으로 연결한 'DeepEncoder'의 작동 원리를 쉽게 알아봅니다. 텍스트를 10배로 압축하면서도 97%의 정확도를 달성한 놀라운 결과를 확인하고, 문서 속 차트나 화학식까지 분석하는 '딥 파싱' 기능도 살펴봅니다. 나아가 이 기술이 인간의 기억처럼 AI에게 '망각 메커니즘'을 만들어 줄 수 있다는 미래 가능성까지 함께 탐구합니다. AI의 텍스트 처리 방식에 대한 고정관념을 완전히 뒤바꿀 수 있는 흥미로운 연구를 지금 바로 확인해 보세요.\n\nWritten by Error \nEdited by Error\n\nunrealtech2021@gmail.com	https://i.ytimg.com/vi/S2VCvsE2iOk/default.jpg	안될공학 - IT 테크 신기술	800	2025-10-20 14:01:52+00	85086	1930	2026-03-06 08:41:28.173+00	2026-03-06 08:41:28.173+00
f0704d06-65e6-4e6f-91f3-fd7bd4ed5e6e	3JsoZGLQQRk	35분 만에 클로드 코드 마스터하기! 실제 제작과정 포함!!(꿀팁 받아가세요!)	👉 10xLeverage AI 평생 멤버십 : https://10xleverageai.vercel.app/\n👉 오픈 채팅방 입장 후 무료 자료 받기 : https://open.kakao.com/o/gNIrvzNg\n👉 바이브코딩으로 만든 벤치튜브 : https://benchtube.ai.kr/\n\n👋 챕터\n00:00 : 소개 및 Claude Code 개요\n00:55 : Claude Code 설치 및 환경 설정\n02:16 : Next.js 개발 환경 구축\n03:37 : Cursor 확장자 및 주요 명령어 소개\n05:03 : /init - 프로젝트 자동 분석\n07:28 : Git 버전 관리 및 GitHub 연동\n08:42 : 동기부여 웹사이트 제작 시작\n10:48 : 플랜 모드(Plan Mode) 활용법\n14:50 : 고급 명령어 (/ultrathink, /compact)\n17:05 : 이미지를 활용한 UI 변경\n20:07 : Supabase 데이터베이스 연동\n20:47 : MCP 기능 소개 및 활용\n27:50 : 커스텀 명령어 제작 및 활용\n31:08 : 서브 에이전트(Sub-Agent) 생성 및 활용\n34:14 : 마무리	https://i.ytimg.com/vi/3JsoZGLQQRk/default.jpg	게으른 일잘러 LazyAchiever	2084	2025-08-09 06:57:51+00	12272	348	2026-03-06 08:41:28.107+00	2026-03-06 08:41:28.107+00
a1ae134c-d43b-402a-849e-d88f7fe9f951	vMW4coDKplw	OpenClaw에서 꼭 써야 할 7가지 에이전트 도구입니다.	OpenClaw를 더욱 강력하게 만드는 7가지 필수 에이전트 도구를 알아봅시다.\n\n📋 주요 내용:\n• Clawsec - OpenClaw 보안 도구 모음 (Heartbeat, CVE 확인, 정합성 검증)\n• Antfarm - 결정론적 워크플로우가 포함된 멀티 에이전트 시스템\n• LanceDB Pro - 하이브리드 벡터 검색과 세션 메모리 기능\n• Unbrowse - 에이전트 네이티브 브라우저 자동화 도구\n• Molt Worker - Cloudflare 서버리스 배포 솔루션\n• OpenClaw Dashboard - 에이전트 메트릭과 비용 모니터링 대시보드\n• Awesome OpenClaw Skills - 보안 검증된 스킬 큐레이션 라이브러리\n\n이 영상은 실제 구현 방식과 각 도구의 설정 과정을 자세히 다룹니다. OpenClaw 생태계에서 실제로 작동하는 보안 도구들을 활용하여 당신의 AI 에이전트 설정을 안전하고 효율적으로 구축하세요.\n\n#OpenClaw #AI #에이전트 #보안 #개발자\n\n📎 관련 링크:\nhttp://ailabspro.io/\nhttps://github.com/prompt-security/clawsec\nhttps://github.com/snarktank/antfarm\nhttps://github.com/mudrii/openclaw-dashboard\nhttps://github.com/cloudflare/moltworker\nhttps://github.com/win4r/memory-lancedb-pro\nhttps://github.com/unbrowse-ai/unbrowse\nhttps://github.com/VoltAgent/awesome-openclaw-skills	https://i.ytimg.com/vi/vMW4coDKplw/default.jpg	Tech Bridge	726	2026-03-08 22:00:51+00	351	9	2026-03-11 06:33:43.019+00	2026-03-11 06:33:43.019+00
f42efb1d-bd47-405f-8573-588fe9cf5113	50y0N1vnH0Y	How to Create Architecture Diagrams with MCP: Claude, Draw.io & Excalidraw !	Discover how to leverage the Model Context Protocol (MCP) to generate professional architectural diagrams directly within Claude Desktop and VS Code. In this tutorial, we explore how to set up and use Excalidraw and Draw.io MCP servers to transform text prompts into high-level visual designs. Whether you're building a modern web app or a complex payment system, see how AI can automate your documentation workflow. We also cover integrating these capabilities into VS Code via GitHub Copilot Chat for a seamless developer experience.\n\nChapters :\n*******************************************************************\n00:00 Intro to AI Diagramming with MCP\n00:16 Setting up Excalidraw in Claude Desktop\n01:26 Generating a Web App Architecture with Claude\n02:57 Configuring Local Draw.io MCP Server\n04:35 Creating Payment Flow Diagrams via MCP\n05:08 Integrating MCP with VS Code & GitHub Copilot\n06:50 Using "Skills" for Advanced Draw.io Diagrams\n08:35 Wrap-up & Conclusion\n\nInterested to learn more, check these playlists :\n*********************************************************\nGoogle's ADK Series : https://www.youtube.com/playlist?list=PLO66QfE8gWT0YP11jJhdV4T5XCsI1Oq9B\n\nOpenAI Agent SDK Series : https://www.youtube.com/playlist?list=PLO66QfE8gWT0oM1hbfcFUa-2H3yI4vfg8\n\nSpring AI  Tutorials : Generative AI for Java Developers : https://www.youtube.com/playlist?list=PLO66QfE8gWT1lyNltpE73ee8mVn6C4xN9\n\nGen AI using Open Source Models : https://www.youtube.com/playlist?list=PLO66QfE8gWT2ITZK2d894R7zvq0J1eeDd\n\nGenerative AI using Native APIs : https://www.youtube.com/playlist?list=PLO66QfE8gWT36LUYEV1SkfxhVw3pt2ThS\n\nGetting Started with Azure AI Services : https://www.youtube.com/playlist?list=PLO66QfE8gWT1m_u6PZt9Tw-Fb2RXjNCJ7	https://i.ytimg.com/vi/50y0N1vnH0Y/default.jpg	TechyTacos	527	2026-03-06 14:30:04+00	12268	246	2026-03-11 06:33:42.742+00	2026-03-11 06:33:42.742+00
d7b350bd-9172-442a-b85c-d927c72319c5	JojcJe5dJTI	Don't guess: How to benchmark your AI prompts	Stop guessing with your AI prompts! Join me, Martin Omander, as I give you a clear "prompt ops" framework to test, benchmark, and automate your prompts like a professional engineer. Learn how to move from messy "prompt churn" to building reliable generative AI applications using Google Cloud's powerful tools.\n\nIn this tutorial, Martin guides you through a 3 stage framework (craft, benchmark, integrate) to manage your prompts from start to finish. Developers will learn how to use Google Cloud tools for rapid prototyping, get hard numbers with data driven benchmarking, and finally, build an automated CI/CD pipeline for true quality control, all while avoiding common pitfalls.  \n\nResources:\nCode Repo (Python Notebook & Node.js Scripts) → https://goo.gle/4h6GhLn\nCurrent Evaluation library used in this video → https://goo.gle/4h8WbVf\nNew Evaluation library (which was still in Preview as this video was recorded) → https://goo.gle/4h890iN\n\nChapters:\n0:00 - The problem with "prompt churn" \n0:49 - The prompt ops framework \n1:14 - Stage 1: "Craft" (Prototyping in Google Cloud Console) \n2:50 - Stage 2: "Benchmark" (Getting hard numbers) \n4:47 - Stage 3: "Integrate" (Automating with CI/CD) \n6:34 - Final thoughts: From guessing to engineering\n\nWatch more Serverless Expeditions → https://goo.gle/ServerlessExpeditions\n🔔 Subscribe to Google Cloud Tech → https://goo.gle/GoogleCloudTech\n\n#GoogleCloud #Serverless #VertexAI\n\nSpeakers: Martin Omander\nProducts Mentioned: Google Cloud Console	https://i.ytimg.com/vi/JojcJe5dJTI/default.jpg	Google Cloud Tech	435	2025-10-23 19:00:29+00	4955	183	2026-03-06 08:41:28.13+00	2026-03-06 08:41:28.13+00
10a2f524-0cd3-4ba5-97ea-b6f7e727f99c	hEE0mc-3D_c	Claude Code Worktrees Just Got Native Support (Here's What Changed)	Native Git WorkTree support just landed in Claude Code — but it doesn't give you database isolation. Here's how to extend it for real Rails projects.\n\nIn this video, I walk through how to use Claude Code's new `--worktree` flag alongside a custom WorkTreeCreate hook to give each agent session its own isolated database. If you're running multiple agents in parallel on a Rails app, this is the setup you need.\n\n---\n\n*What you'll learn:*\n- What native Claude Code WorkTree support does (and where it falls short)\n- How the WorkTreeCreate hook works and when it fires\n- How to write a setup script that creates per-worktree databases with unique names\n- How to use the WorkTreeRemove hook to clean up databases automatically\n- Why these patterns apply beyond Rails to any app with external state\n\n---\n\n*Watch next:*\n- Git Worktrees for AI Agents (the original script approach) → https://youtu.be/ryGJLXruUxs\n\n---\n\n*Resources mentioned:*\n- WorktreeCreate hook source → subscribe to get it: https://www.damiangalarza.com/newsletter?utm_source=youtube&utm_medium=video&utm_campaign=native-claude-code-worktrees\n- Claude Code docs: https://docs.anthropic.com/claude-code\n\n---\n\n→ Running Claude Code on a real codebase? I help engineering teams set up exactly these kinds of workflows:\nhttps://www.damiangalarza.com/claude-code?utm_source=youtube&utm_medium=video&utm_campaign=native-claude-code-worktrees\n\n→ Newsletter — practical AI without the hype:\nhttps://www.damiangalarza.com/newsletter?utm_source=youtube&utm_medium=video&utm_campaign=native-claude-code-worktrees\n\n---\n\n*Timestamps:*\n0:00 - Intro\n0:16 - What Git WorkTrees are and why agents need them\n1:08 - What Claude Code's native WorkTree support does\n2:10 - The .worktree include file\n2:42 - Multiple entry points (CLI, mid-session, sub-agents)\n3:11 - Where native WorkTrees fall short for Rails\n3:52 - True isolation: what it actually requires\n4:09 - The WorkTreeCreate hook\n4:57 - Hook configuration in settings.json\n5:22 - Walking through the setup script\n6:35 - Demo: running the hook\n6:56 - Running specs with full isolation\n7:01 - Cleaning up: WorkTreeRemove hook\n7:38 - These patterns work beyond Rails\n7:56 - Outro\n\n---\n\n*Work with me:*\n- 1:1 Coaching (Claude Code, agent architecture, AI workflows): https://www.damiangalarza.com/coaching?utm_source=youtube&utm_medium=video&utm_campaign=native-claude-code-worktrees\n- All services: https://www.damiangalarza.com/services\n\n---\n\n*About me:*\nI'm Damian Galarza — Senior Software Engineer at August Health, building AI systems in production. Previously CTO at Buoy Software where I scaled a team from 0 to 50+ and shipped FDA-cleared software. I make practical AI engineering content on agent architecture, LLM applications, and production AI systems.\n\n*Connect:*\n- LinkedIn: https://www.linkedin.com/in/dgalarza\n- X: https://x.com/dgalarza\n- Blog: https://www.damiangalarza.com\n\n#ClaudeCode #AIEngineering #GitWorktrees #claudecodetutorial	https://i.ytimg.com/vi/hEE0mc-3D_c/default.jpg	Damian Galarza	518	2026-03-10 16:00:58+00	2835	79	2026-03-12 00:10:00.336+00	2026-03-12 00:10:00.336+00
16c07938-85de-4bc1-a066-83630b1e62e7	yey_9vhLRmY	클로드 코드로 PPT 만들기: 스킬 제작부터 마켓플레이스 배포까지	클로드 코드 스킬 하나로 PPT를 만들고, 플러그인으로 묶어서 마켓플레이스에 공유하는 전체 과정을 보여드립니다.\nskill-creator로 공식 문서 기반 스킬을 생성하고, 서브에이전트로 리서치를 병렬 수집한 뒤, 완성된 스킬을 팀 전체가 재사용할 수 있도록 배포합니다.\n\n📌 이런 분들께 추천합니다\n• 나만의 PPT 스킬을 만들어보고 싶은 분\n• 팀에서 클로드 코드 스킬을 공유하고 싶은 분\n• Claude Code를 개발 외에도 활용해보고 싶은 분\n\n⏰ 타임라인\n00:00 PPT 어떻게 만드셨나요? — 오프닝\n00:59 Anthropic 공식 pptx 스킬 vs HTML 웹 PPT 비교\n01:34 웹 PPT 스킬 만들기 — skill-creator 소개\n02:55 구독/좋아요/후원 CTA\n03:00 Anthropic 공식 플러그인 마켓플레이스 둘러보기\n04:27 마켓플레이스에서 skill-creator 설치하기\n05:15 서브에이전트 병렬 리서치 — 수집 단계\n06:43 프롬프트 편집 팁 (Ctrl+G)\n07:26 서브에이전트 vs 에이전트 팀 차이점\n08:35 리서치 결과 검토 및 수정 — 사람의 판단이 중요\n10:08 인프런 강의 소개\n10:26 skill-creator로 웹 PPT 스킬 생성\n11:12 완성된 스킬로 PPT 실시간 생성 시연\n12:35 스킬 vs 플러그인 vs 마켓플레이스 개념 정리\n14:02 스킬을 플러그인으로 변환하기\n15:02 나만의 마켓플레이스 만들고 GitHub 배포\n16:31 다른 프로젝트에서 플러그인 설치하기\n17:27 플러그인 자동 업데이트 설정\n18:40 영상 정리 + 마무리\n\n📚 클로드 코드 완벽 마스터 (인프런 강의)\n출시 3개월 만에 3,500여 명이 선택한 강의!\n공식 문서 기반으로 클로드 코드 스펙을 제대로 학습하고,\n실무에서 바로 쓸 수 있는 AI 개발 워크플로우를 체득합니다.\n👉 https://gymcoding.co/vip\n\n☕ 커피 한 잔 후원하기\n채널 운영에 큰 힘이 됩니다!\n👉 https://www.youtube.com/channel/UCZ30aWiMw5C8mGcESlAGQbA/join\n\n🔗 영상에서 다룬 링크\n• Anthropic 공식 플러그인 마켓플레이스: https://github.com/anthropics/claude-plugins-official\n• Claude Code 공식 문서: https://docs.anthropic.com/en/docs/claude-code\n\n#클로드코드 #ClaudeCode #AI #PPT만들기 #스킬 #플러그인 #마켓플레이스 #skillcreator #서브에이전트 #AI개발 #개발자도구 #Claude #Anthropic	https://i.ytimg.com/vi/yey_9vhLRmY/default.jpg	짐코딩	1191	2026-03-11 09:01:30+00	4486	142	2026-03-12 00:10:00.388+00	2026-03-12 00:10:00.388+00
\.


--
-- Data for Name: user_video_states; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_video_states (id, user_id, video_id, is_in_ideation, user_note, watch_position_seconds, is_watched, cell_index, level_id, sort_order, added_to_ideation_at, created_at, updated_at, mandala_id) FROM stdin;
d68560a6-27c7-4779-b5fa-666b002e71fb	0192fedf-85f4-47ab-a652-7fdd116e2b39	d7b350bd-9172-442a-b85c-d927c72319c5	f	\N	0	f	-1	scratchpad	5	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:08:26.281+00	49763883-e295-4ea9-abec-ae7cea08d5a0
3fd926a2-098d-4542-a048-7587758c16b2	0192fedf-85f4-47ab-a652-7fdd116e2b39	a1ae134c-d43b-402a-849e-d88f7fe9f951	f	\N	0	f	-1	scratchpad	4	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.284+00	\N
f3f6b487-974e-4c86-8223-919fd449d569	0192fedf-85f4-47ab-a652-7fdd116e2b39	fabc918b-cfeb-42c3-b48e-cbba77d79de1	f	\N	0	f	-1	scratchpad	0	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.638+00	\N
94858583-4c43-4546-b6f3-d17e3b981b82	0192fedf-85f4-47ab-a652-7fdd116e2b39	2ef6ca18-1367-4893-b8fe-b96fc952fe03	f	\N	0	f	-1	scratchpad	7	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.673+00	\N
ab7ce64d-e59a-4ae7-9f00-0a97740db617	0192fedf-85f4-47ab-a652-7fdd116e2b39	e838a1cf-a7aa-4660-817a-1b88df5e3b5c	f	\N	0	f	-1	scratchpad	0	2026-03-12 00:10:00.567+00	2026-03-12 00:10:00.567+00	2026-03-12 00:10:34.833+00	\N
2cfbbeba-9b4d-4d51-b387-1eed6dca0ad6	0192fedf-85f4-47ab-a652-7fdd116e2b39	10a2f524-0cd3-4ba5-97ea-b6f7e727f99c	f	\N	0	f	-1	scratchpad	1	2026-03-12 00:10:00.567+00	2026-03-12 00:10:00.567+00	2026-03-12 00:10:34.838+00	\N
e9e9e426-8a2a-4cb7-a988-af61cce9cc5e	0192fedf-85f4-47ab-a652-7fdd116e2b39	16c07938-85de-4bc1-a066-83630b1e62e7	f	\N	0	f	-1	scratchpad	2	2026-03-12 00:10:00.567+00	2026-03-12 00:10:00.567+00	2026-03-12 00:10:34.851+00	\N
18619399-3eba-480f-ac08-2079ee2884ec	0192fedf-85f4-47ab-a652-7fdd116e2b39	f0704d06-65e6-4e6f-91f3-fd7bd4ed5e6e	f	\N	0	f	-1		1	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:07:57.122+00	49763883-e295-4ea9-abec-ae7cea08d5a0
df457be7-2e8a-4c1a-9cd9-b35684255dfa	0192fedf-85f4-47ab-a652-7fdd116e2b39	b736573b-a85b-4b55-9f7e-f4bd13ec2165	f	\N	0	f	-1		0	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:07:57.134+00	49763883-e295-4ea9-abec-ae7cea08d5a0
4d4436bb-0a43-4b25-b22a-8d5542fd7316	0192fedf-85f4-47ab-a652-7fdd116e2b39	9c576f69-8d4d-4264-9fa4-7042e678115e	f	\N	0	f	-1		7	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:07:57.442+00	49763883-e295-4ea9-abec-ae7cea08d5a0
886e34fc-4905-4a35-9de5-39736041a592	0192fedf-85f4-47ab-a652-7fdd116e2b39	cbab6a7d-6290-448c-a3fd-8b9450939440	f	\N	0	f	-1		8	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:07:57.463+00	49763883-e295-4ea9-abec-ae7cea08d5a0
35785bd7-b4d0-449e-8f25-53cad901aa2b	0192fedf-85f4-47ab-a652-7fdd116e2b39	9005ecb0-a89b-4df2-8373-21225898e02c	f	\N	0	f	-1		4	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:07:57.479+00	49763883-e295-4ea9-abec-ae7cea08d5a0
3ee2b208-ba1f-48f9-aa5e-4f3d7dc6e68e	0192fedf-85f4-47ab-a652-7fdd116e2b39	763f18a0-38ff-41d9-ab99-728418861f3e	f	\N	0	f	-1		2	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:07:57.51+00	49763883-e295-4ea9-abec-ae7cea08d5a0
6fa23079-bfbd-497d-bab6-7b32160e2d9c	0192fedf-85f4-47ab-a652-7fdd116e2b39	1a5c61b0-dbb0-4e45-9cdf-06ea7eeee01b	f	\N	0	f	-1	scratchpad	1	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.12+00	\N
2f9ed1eb-7a12-4e0a-bc8d-53191e1ac335	0192fedf-85f4-47ab-a652-7fdd116e2b39	2776e142-5948-43d9-8b3c-a5c8752e3476	f	\N	0	f	-1	scratchpad	6	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:08:26.171+00	49763883-e295-4ea9-abec-ae7cea08d5a0
d3a41911-2a81-49ed-ac9a-b533b9afe0db	0192fedf-85f4-47ab-a652-7fdd116e2b39	f048abf6-d977-48a7-929d-9045e17fa700	f	\N	0	f	-1	scratchpad	9	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.205+00	\N
c222ba72-b3a0-4720-9bab-fc5e325fb69b	0192fedf-85f4-47ab-a652-7fdd116e2b39	61f7ce38-2295-4b4f-8723-a1600ea7517b	f	\N	0	f	-1	scratchpad	5	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.209+00	\N
1e36154d-2034-4852-9708-f3e128dcb303	0192fedf-85f4-47ab-a652-7fdd116e2b39	2ed2eda2-7049-41ef-8628-14d7c42cf757	f	\N	0	f	-1	scratchpad	6	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.225+00	\N
91c82123-8ac4-440e-b5d8-9332b5aeb859	0192fedf-85f4-47ab-a652-7fdd116e2b39	f42efb1d-bd47-405f-8573-588fe9cf5113	f	\N	0	f	-1	scratchpad	2	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.221+00	\N
46ab1e37-55e9-43b6-9900-e517152a9736	0192fedf-85f4-47ab-a652-7fdd116e2b39	7d7cdab8-e789-4fde-ba3f-139a260e6958	f	\N	0	f	-1	scratchpad	10	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.239+00	\N
c3ea9598-647c-49ba-83ba-ec704e27e912	0192fedf-85f4-47ab-a652-7fdd116e2b39	24bd31fe-2357-4d1f-9152-5e1d671cee3a	f	\N	0	f	-1	scratchpad	8	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.258+00	\N
392a14ee-79ab-4bd9-b1d2-db37d9fa5548	0192fedf-85f4-47ab-a652-7fdd116e2b39	6ff82851-87b1-42c0-bd21-e47d74ffef5f	f	\N	0	f	-1	scratchpad	3	2026-03-11 06:33:43.295+00	2026-03-11 06:33:43.295+00	2026-03-12 00:08:26.263+00	\N
2651135a-afe3-4c1e-b0c8-f02156b4a974	0192fedf-85f4-47ab-a652-7fdd116e2b39	5d122b0b-3266-4964-acb7-a9690592c5de	f	\N	0	f	-1	scratchpad	3	2026-03-06 09:51:54.379+00	2026-03-06 09:51:54.379+00	2026-03-12 00:08:26.601+00	49763883-e295-4ea9-abec-ae7cea08d5a0
\.


--
-- Data for Name: video_captions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.video_captions (id, video_id, language, text, segments, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: video_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.video_notes (id, video_id, timestamp_seconds, content, tags, created_at, updated_at, user_id) FROM stdin;
\.


--
-- Data for Name: watch_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.watch_sessions (id, video_id, started_at, ended_at, start_pos, end_pos, duration, created_at, user_id) FROM stdin;
\.


--
-- Data for Name: youtube_playlist_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.youtube_playlist_items (id, playlist_id, video_id, "position", added_at, removed_at) FROM stdin;
3d008dc5-4487-434f-a9bd-5817fdb6eb24	f303e57f-c75b-4406-906a-6f90f99c837d	e838a1cf-a7aa-4660-817a-1b88df5e3b5c	0	2026-03-11 23:36:30+00	\N
63135594-3281-4eef-a5d2-3fcd865264a8	f303e57f-c75b-4406-906a-6f90f99c837d	10a2f524-0cd3-4ba5-97ea-b6f7e727f99c	1	2026-03-11 18:19:49+00	\N
157238cb-85fe-4f04-8c85-8a9da1c7a68c	f303e57f-c75b-4406-906a-6f90f99c837d	16c07938-85de-4bc1-a066-83630b1e62e7	2	2026-03-11 10:55:37+00	\N
bdd11983-8d52-4ccc-b50f-3606bafd9f6b	f303e57f-c75b-4406-906a-6f90f99c837d	fabc918b-cfeb-42c3-b48e-cbba77d79de1	3	2026-03-10 16:30:01+00	\N
b2f0e469-20c8-436e-871c-b03f5a8d5992	f303e57f-c75b-4406-906a-6f90f99c837d	1a5c61b0-dbb0-4e45-9cdf-06ea7eeee01b	4	2026-03-10 15:35:55+00	\N
dc74163f-3990-4c93-8547-674a28654bd8	f303e57f-c75b-4406-906a-6f90f99c837d	f42efb1d-bd47-405f-8573-588fe9cf5113	5	2026-03-10 09:58:06+00	\N
a3d2fd38-f68c-485c-ba93-763bd38af317	f303e57f-c75b-4406-906a-6f90f99c837d	6ff82851-87b1-42c0-bd21-e47d74ffef5f	6	2026-03-10 09:50:00+00	\N
9723f4d8-f3fb-4740-bd1b-50c4955597d6	f303e57f-c75b-4406-906a-6f90f99c837d	a1ae134c-d43b-402a-849e-d88f7fe9f951	7	2026-03-09 17:43:48+00	\N
dd38306d-7f7d-46e7-aaa9-c297c3bf874c	f303e57f-c75b-4406-906a-6f90f99c837d	61f7ce38-2295-4b4f-8723-a1600ea7517b	8	2026-03-09 12:43:55+00	\N
68eaae09-a223-4a4a-bef2-f31bf98b8b79	f303e57f-c75b-4406-906a-6f90f99c837d	2ed2eda2-7049-41ef-8628-14d7c42cf757	9	2026-03-09 12:41:34+00	\N
2b5bed65-2ed7-4e65-88ae-8bdb5d64fed9	f303e57f-c75b-4406-906a-6f90f99c837d	2ef6ca18-1367-4893-b8fe-b96fc952fe03	10	2026-03-08 14:23:48+00	\N
69329ced-1d71-497c-a6b5-20800ae3c879	f303e57f-c75b-4406-906a-6f90f99c837d	24bd31fe-2357-4d1f-9152-5e1d671cee3a	11	2026-03-08 12:33:37+00	\N
6fe8d20e-0fec-4c57-b1b8-7f22d7d62465	f303e57f-c75b-4406-906a-6f90f99c837d	f048abf6-d977-48a7-929d-9045e17fa700	12	2026-03-07 14:32:11+00	\N
0fec1bfa-070c-4c70-86f2-d46a8bce32ce	f303e57f-c75b-4406-906a-6f90f99c837d	7d7cdab8-e789-4fde-ba3f-139a260e6958	13	2026-03-07 14:07:38+00	\N
86f6e298-8af8-4c8e-9e1f-b42f4a526290	f303e57f-c75b-4406-906a-6f90f99c837d	cbab6a7d-6290-448c-a3fd-8b9450939440	14	2026-02-09 14:21:25+00	\N
a522f348-fd96-46d0-9f7b-208dc423ce6d	f303e57f-c75b-4406-906a-6f90f99c837d	9c576f69-8d4d-4264-9fa4-7042e678115e	15	2026-01-25 12:54:36+00	\N
dd22e75b-8544-43fd-a14d-4b92ec408e03	f303e57f-c75b-4406-906a-6f90f99c837d	2776e142-5948-43d9-8b3c-a5c8752e3476	16	2025-10-30 16:51:13+00	\N
b6e9e200-6ca2-4e0d-b713-5c8b05ff5886	f303e57f-c75b-4406-906a-6f90f99c837d	d7b350bd-9172-442a-b85c-d927c72319c5	17	2025-10-30 13:59:38+00	\N
74555283-3199-4fe8-a77d-4ae9213ce38e	f303e57f-c75b-4406-906a-6f90f99c837d	9005ecb0-a89b-4df2-8373-21225898e02c	18	2025-10-20 15:05:46+00	\N
f8686de5-659e-4689-bede-a92c38a7199d	f303e57f-c75b-4406-906a-6f90f99c837d	5d122b0b-3266-4964-acb7-a9690592c5de	19	2025-10-13 13:54:55+00	\N
29f540df-37c0-468e-b8d1-55b0f7440d7e	f303e57f-c75b-4406-906a-6f90f99c837d	763f18a0-38ff-41d9-ab99-728418861f3e	20	2025-10-11 12:07:43+00	\N
8266b17e-8a46-4f63-b79f-694414e0e0d4	f303e57f-c75b-4406-906a-6f90f99c837d	f0704d06-65e6-4e6f-91f3-fd7bd4ed5e6e	21	2025-10-02 11:29:14+00	\N
f6284947-c2bf-4bca-9d9b-4fbee38a11db	f303e57f-c75b-4406-906a-6f90f99c837d	b736573b-a85b-4b55-9f7e-f4bd13ec2165	22	2025-10-02 07:47:24+00	\N
\.


--
-- Data for Name: youtube_sync_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.youtube_sync_history (id, playlist_id, status, started_at, completed_at, items_added, items_removed, error_message, quota_used) FROM stdin;
e619d8fc-ddfc-48f7-a34c-88ae226fb65c	f303e57f-c75b-4406-906a-6f90f99c837d	COMPLETED	2026-03-06 08:41:27.697+00	2026-03-06 08:41:28.337+00	9	0	\N	2
3defa45a-b14a-45d5-948f-0b39b8ea38e8	f303e57f-c75b-4406-906a-6f90f99c837d	COMPLETED	2026-03-06 09:30:35.173+00	2026-03-06 09:30:35.608+00	0	0	\N	2
d40432e9-87a1-4ade-bcbd-cfb69c853e6d	f303e57f-c75b-4406-906a-6f90f99c837d	COMPLETED	2026-03-06 09:30:53.375+00	2026-03-06 09:30:53.597+00	0	0	\N	2
8b1885a8-20b7-49e6-bdad-5e9047727730	f303e57f-c75b-4406-906a-6f90f99c837d	COMPLETED	2026-03-06 09:51:53.985+00	2026-03-06 09:51:54.402+00	0	0	\N	2
eeef5ace-3df7-4495-b493-7e700bdc3cdf	f303e57f-c75b-4406-906a-6f90f99c837d	COMPLETED	2026-03-06 09:52:19.382+00	2026-03-06 09:52:19.609+00	0	0	\N	2
dc3e8709-2e77-4016-a322-fac3e2f502dc	f303e57f-c75b-4406-906a-6f90f99c837d	COMPLETED	2026-03-06 09:55:40.272+00	2026-03-06 09:55:40.554+00	0	0	\N	2
de87dbe5-dbd4-4dd9-8fe8-9c02713463cf	f303e57f-c75b-4406-906a-6f90f99c837d	FAILED	2026-03-07 02:45:52.694+00	2026-03-07 02:46:31.975+00	0	0	Requests from referer <empty> are blocked.	0
b0b42971-fbbd-4377-95a5-2b8aa1002431	f303e57f-c75b-4406-906a-6f90f99c837d	completed	2026-03-11 06:33:42.084+00	2026-03-11 06:33:43.314+00	11	0	\N	2
aa93abde-a64d-42aa-bac5-1c0d0937bba9	f303e57f-c75b-4406-906a-6f90f99c837d	completed	2026-03-11 07:10:44.413+00	2026-03-11 07:10:45.301+00	0	0	\N	2
9a7ecc1e-7cf4-44ff-af14-c725c9bbca53	f303e57f-c75b-4406-906a-6f90f99c837d	completed	2026-03-12 00:09:59.732+00	2026-03-12 00:10:00.583+00	3	0	\N	2
c591c728-5595-4a41-a469-3e6ae5c4128e	f303e57f-c75b-4406-906a-6f90f99c837d	completed	2026-03-12 00:10:06.339+00	2026-03-12 00:10:06.946+00	0	0	\N	2
3435c85c-459b-4f01-af0a-cc1b608cf891	f303e57f-c75b-4406-906a-6f90f99c837d	completed	2026-03-12 00:10:09.081+00	2026-03-12 00:10:09.572+00	0	0	\N	2
\.


--
-- Data for Name: youtube_sync_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.youtube_sync_settings (id, user_id, sync_interval, auto_sync_enabled, youtube_access_token, youtube_refresh_token, youtube_token_expires_at, created_at, updated_at) FROM stdin;
\.


--
-- PostgreSQL database dump complete
--

\unrestrict OPtJP1NJMrDczZHwwVgVE88eY7BeEE81RdB7SajGLqwCn2UuDP1F0NHqbDjPjuO

