<script lang="ts">
	export let data;
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
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
	//import { createLogger } from 'vite';
	//const log = createLogger();
	const showNewStep = data.status === 'done';
	let newSeeds: string;
	let whiteList: string;
	let blackList: string;
	let maxPathLength: number = data.currentStep.maxPathLength;
	let maxPathProps: number = data.currentStep.maxPathProps;

	async function addStep() {
		const ns = newSeeds?.split(/\s*[\n,]\s*/).filter((s: string) => !s.match(/^\s*$/));
		const wl = whiteList?.split(/\s*[\n,]\s*/).filter((s: string) => !s.match(/^\s*$/));
		const bl = blackList?.split(/\s*[\n,]\s*/).filter((s: string) => !s.match(/^\s*$/));

		try {
			await fetch(`/api/processes/${data.pid}/add-step`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					maxPathLength,
					maxPathProps,
					newSeeds: ns,
					whiteList: wl,
					blackList: bl
				})
			});

			// new step created
			goto(`/processes/${data.pid}`);
		} catch (e) {
			//log.error('Error adding new step' + e);
			goto(`/processes/${data.pid}`);
		}
	}
</script>

<Container>
	<header style="padding-bottom: 1rem">
		<h2>Edit crawling process</h2>
	</header>

	<Container>
		<Row>
			<Col>
				<Accordion>
					<AccordionItem header="Add new crawling step" active>
						{#if showNewStep}
							<!-- form
								id="new-crawl-step"
								action="/processes/{data.pid}?/addStep"
								method="POST"
								use:enhance={() => {
									return ({ update }) => update({ reset: false });
								}}
							-->
							<FormGroup>
								<Row>
									<Col sm={2}>
										<Label>Additional seeds:</Label>
									</Col>
									<Col sm={10}>
										<InputGroup>
											<Input
												id="seeds"
												name="seeds"
												type="textarea"
												bind:value={newSeeds}
												rows={3}
												form="new-crawl-step"
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
												bind:value={maxPathLength}
												type="number"
												name="maxPathLength"
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
												bind:value={maxPathProps}
												type="number"
												name="maxPathProps"
											/>
										</InputGroup>
									</Col>
								</Row>
							</FormGroup>

							<FormGroup>
								<Row>
									<Col sm={2}>
										<Label>Predicate white list:</Label>
									</Col>
									<Col sm={10}>
										<InputGroup>
											<Input
												id="whiteList"
												name="whiteList"
												type="textarea"
												bind:value={whiteList}
												rows={3}
												form="new-crawl-step"
											/>
											<Tooltip target="white-list-tt">One resource URL per line</Tooltip>
											<InputGroupText id="white-list-tt">?</InputGroupText>
										</InputGroup>
									</Col>
								</Row>
							</FormGroup>

							<FormGroup>
								<Row>
									<Col sm={2}>
										<Label>Predicate black list:</Label>
									</Col>
									<Col sm={10}>
										<InputGroup>
											<Input
												id="blackList"
												name="blackList"
												type="textarea"
												bind:value={blackList}
												rows={3}
												form="new-crawl-step"
											/>
											<Tooltip target="black-list-tt">One resource URL per line</Tooltip>
											<InputGroupText id="black-list-tt">?</InputGroupText>
										</InputGroup>
									</Col>
								</Row>
							</FormGroup>
							<FormGroup>
								<Col sm={10}>
									<Button color="primary" on:click={addStep} type="button">Add new step</Button>
								</Col>
							</FormGroup>
							<!-- /form -->
						{:else}
							<p>
								Current step is not done yet, you need to wait for it to finish before adding more
								steps.
							</p>
						{/if}
					</AccordionItem>
					<AccordionItem header="Edit other settings">
						<form
							id="edit-proc"
							method="POST"
							use:enhance={() => {
								return ({ update }) => update({ reset: false });
							}}
						>
							<FormGroup>
								<Row>
									<Col sm={1}>
										<Label>Email:</Label>
									</Col>
									<Col sm={{ size: 6, offset: 1 }}>
										<InputGroup>
											<Input name="email" placeholder={data.notification.email} />
											<Tooltip target="email-tt"
												>We'll only send you 3 emails: confirming your process has been added; when
												your process starts; and when your process finishes. No SPAM</Tooltip
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
											<Input name="webhook" />
											<Tooltip target="webhook-tt"
												>An HTTP callback which can be used to send notifications when the status of
												this process changes.</Tooltip
											>
											<InputGroupText id="webhook-tt">?</InputGroupText>
										</InputGroup>
									</Col>
								</Row>
							</FormGroup>
							<FormGroup>
								<Col sm={10}>
									<Button color="primary" type="submit">Save</Button>
								</Col>
							</FormGroup>
						</form>
					</AccordionItem>
				</Accordion>
			</Col>
		</Row>
	</Container>
</Container>
