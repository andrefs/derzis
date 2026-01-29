<script lang="ts">
	import { applyAction, deserialize, enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { ActionResult } from '@sveltejs/kit';
	import {
		Container,
		Row,
		Col,
		InputGroup,
		Accordion,
		Button,
		Tooltip,
		FormGroup,
		AccordionItem,
		Label,
		Input,
		InputGroupText
	} from '@sveltestrap/sveltestrap';
	let resources = '';
	let maxPathLength = 3;
	let maxPathProps = 2;
	let email = '';
	let webhook = '';
	let predLimType = 'blacklist';
	let predList = '';

	async function handleSubmit(
		event: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement }
	) {
		event.preventDefault();

		// build form data from variables
		const formData = new FormData();
		formData.append('seeds', resources);
		formData.append('maxPathLength', maxPathLength.toString());
		formData.append('maxPathProps', maxPathProps.toString());
		formData.append('email', email);
		formData.append('webhook', webhook);
		formData.append('limitation-type', predLimType);
		formData.append('pred-list', predList);

		const response = await fetch(event.currentTarget.action, {
			method: 'POST',
			body: formData
		});

		const result: ActionResult = deserialize(await response.text());
		if (result.type === 'success') {
			await invalidateAll();
		}
		applyAction(result);
	}
</script>

<Container>
	<header style="padding-bottom: 1rem">
		<h2>Add new crawling process</h2>
	</header>

	<Container>
		<Row>
			<Col>
				<form
					id="new-proc"
					action="/processes?/newProc"
					onsubmit={handleSubmit}
					use:enhance={() => {
						return ({ update }) => update({ reset: false });
					}}
				>
					<FormGroup>
						<Accordion>
							<AccordionItem active header="General information">
								<FormGroup>
									<Row>
										<Col sm={2}>
											<Label>Resources:</Label>
										</Col>
										<Col sm={10}>
											<InputGroup>
												<Input
													id="seeds"
													name="seeds"
													type="textarea"
													rows={3}
													form="new-proc"
													bind:value={resources}
												/>
												<Tooltip target="resources-tt">One resource URL per line</Tooltip>
												<InputGroupText id="resources-tt">?</InputGroupText>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>

								<FormGroup>
									<Row>
										<Col sm={2}>
											<Label>Max length:</Label>
										</Col>
										<Col sm={2}>
											<InputGroup>
												<Input
													min="1"
													max="20"
													step="1"
													type="number"
													name="maxPathLength"
													bind:value={maxPathLength}
												/>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>

								<FormGroup>
									<Row>
										<Col sm={2}>
											<Label>Max props:</Label>
										</Col>
										<Col sm={2}>
											<InputGroup>
												<Input
													min="1"
													max="5"
													step="1"
													type="number"
													name="maxPathProps"
													bind:value={maxPathProps}
												/>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>
							</AccordionItem>
							<AccordionItem header="Notification options">
								<FormGroup>
									<Row>
										<Col sm={1}>
											<Label>Email:</Label>
										</Col>
										<Col sm={{ size: 6, offset: 1 }}>
											<InputGroup>
												<Input name="email" bind:value={email} />
												<Tooltip target="email-tt"
													>We'll only send you 3 emails: confirming your process has been added;
													when your process starts; and when your process finishes. No SPAM</Tooltip
												>
												<InputGroupText id="email-tt">?</InputGroupText>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>
								<FormGroup>
									<Row>
										<Col sm={1}>
											<Label>Webhook:</Label>
										</Col>
										<Col sm={{ size: 6, offset: 1 }}>
											<InputGroup>
												<Input name="webhook" bind:value={webhook} />
												<Tooltip target="webhook-tt"
													>An HTTP callback which can be used to send notifications when the status
													of this process changes.</Tooltip
												>
												<InputGroupText id="webhook-tt">?</InputGroupText>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>
							</AccordionItem>
							<AccordionItem header="Limit predicates">
								<FormGroup>
									<Row>
										<Col sm={2}>
											<Label>Limitation type:</Label>
										</Col>
										<Col sm={10}>
											<!-- Radio buttons for limitation type: white/black list, default blacklist -->
											<InputGroup>
												<Input
													type="radio"
													id="black-list"
													name="limitation-type"
													value="blacklist"
													bind:group={predLimType}
												/>
												<Label for="black-list" class="ms-2 me-3">Blacklist</Label>
												<Input
													type="radio"
													id="white-list"
													name="limitation-type"
													value="whitelist"
													bind:group={predLimType}
												/>
												<Label for="white-list" class="ms-2">Whitelist</Label>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>
								<FormGroup>
									<Row>
										<Col sm={2}>
											<Label>Predicate list:</Label>
										</Col>
										<Col sm={10}>
											<InputGroup>
												<Input
													id="pred-list"
													name="pred-list"
													type="textarea"
													rows={3}
													form="new-proc"
												/>
												<Tooltip target="white-list-tt">One resource URL per line</Tooltip>
												<InputGroupText id="white-list-tt">?</InputGroupText>
											</InputGroup>
										</Col>
									</Row>
								</FormGroup>
							</AccordionItem>
						</Accordion>
					</FormGroup>

					<FormGroup>
						<Col sm={10}>
							<Button id="form-submit" color="primary" type="submit">Submit</Button>
						</Col>
					</FormGroup>
				</form>
			</Col>
		</Row>
	</Container>
</Container>
